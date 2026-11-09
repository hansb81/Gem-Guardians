package com.teamsdb.gemguardians.onestore

import android.content.pm.ApplicationInfo
import android.util.Log
import com.gaa.sdk.base.Logger
import com.gaa.sdk.iap.AcknowledgeParams
import com.gaa.sdk.iap.ConsumeParams
import com.gaa.sdk.iap.IapResult
import com.gaa.sdk.iap.ProductDetailsParams
import com.gaa.sdk.iap.PurchaseClient
import com.gaa.sdk.iap.PurchaseClient.ProductType
import com.gaa.sdk.iap.PurchaseClient.ResponseCode
import com.gaa.sdk.iap.PurchaseClientStateListener
import com.gaa.sdk.iap.PurchaseData
import com.gaa.sdk.iap.PurchaseFlowParams
import com.gaa.sdk.iap.PurchasesUpdatedListener
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 원스토어 IAP SDK V21(sdk-iap 21.04.00)을 JS(src/platform/capacitor/iap/onestore.js)에 잇는 얇은 다리.
 * onestore flavor에만 있다 - capacitor.plugins.json 등록은 app/build.gradle의 onestorePluginsJson.
 *
 * 모든 메서드는 reject 대신 { code, message, ... }로 resolve한다(code = PurchaseClient.ResponseCode 그대로 -
 * RESULT_NEED_LOGIN 10, RESULT_NEED_UPDATE 11 등은 JS가 보고 로그인/설치 흐름을 고른다).
 * 지급 판단은 JS가 한다: 여기서는 consume/acknowledge를 스스로 하지 않는다(지급 성공 후 JS가 부른다).
 */
@CapacitorPlugin(name = "OneStoreIap")
class OneStoreIapPlugin : Plugin(), PurchasesUpdatedListener {
    private var client: PurchaseClient? = null
    private var purchaseCall: PluginCall? = null
    // consume/acknowledge는 PurchaseData가 필요하다 - 결제·조회로 받은 것을 토큰으로 기억해 둔다.
    private val known = HashMap<String, PurchaseData>()

    override fun load() {
        // 로그 레벨은 debug 빌드에서만(dev_option 메타데이터도 src/onestoreDebug 매니페스트에만 있다).
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) Logger.setLogLevel(Log.VERBOSE)
    }

    override fun handleOnDestroy() {
        client?.endConnection()
        client = null
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val current = client
        if (current != null && current.isReady) return call.resolve(result(ResponseCode.RESULT_OK, ""))
        val key = call.getString("base64PublicKey").orEmpty()
        if (key.isEmpty()) return call.resolve(result(ResponseCode.ERROR_ILLEGAL_ARGUMENT, "base64PublicKey(license key) missing"))
        current?.endConnection()
        val next = PurchaseClient.newBuilder(activity).setBase64PublicKey(key).setListener(this).build()
        client = next
        next.startConnection(object : PurchaseClientStateListener {
            private var answered = false
            override fun onSetupFinished(r: IapResult) = answer(result(r))
            override fun onServiceDisconnected() {
                answer(result(ResponseCode.ERROR_SERVICE_DISCONNECTED, "service disconnected"))
                notifyListeners("disconnected", JSObject())
            }
            private fun answer(data: JSObject) {
                if (answered) return
                answered = true
                call.resolve(data)
            }
        })
    }

    @PluginMethod
    fun getProducts(call: PluginCall) {
        val c = readyClient(call) ?: return
        val ids = try {
            call.getArray("ids")?.toList<String>() ?: emptyList()
        } catch (e: Exception) {
            return call.resolve(result(ResponseCode.ERROR_ILLEGAL_ARGUMENT, "ids must be string[]"))
        }
        val params = ProductDetailsParams.newBuilder().setProductIdList(ids).setProductType(typeOf(call)).build()
        c.queryProductDetailsAsync(params) { r, list ->
            val arr = JSArray()
            list?.forEach {
                arr.put(
                    JSObject()
                        .put("productId", it.productId)
                        .put("type", it.type)
                        .put("title", it.title)
                        .put("price", it.price)
                        .put("priceAmountMicros", it.priceAmountMicros)
                        .put("priceCurrencyCode", it.priceCurrencyCode)
                )
            }
            call.resolve(result(r).put("products", arr))
        }
    }

    // 결제 창을 띄우고, 결과(onPurchasesUpdated)가 오면 이 호출을 resolve한다.
    @PluginMethod
    fun purchase(call: PluginCall) {
        val c = readyClient(call) ?: return
        val productId = call.getString("productId") ?: return call.resolve(result(ResponseCode.ERROR_ILLEGAL_ARGUMENT, "productId missing"))
        purchaseCall?.resolve(result(ResponseCode.RESULT_ERROR, "superseded by a new purchase"))
        val params = PurchaseFlowParams.newBuilder()
            .setProductId(productId)
            .setProductType(typeOf(call))
            .setDeveloperPayload(call.getString("developerPayload"))
            .build()
        purchaseCall = call
        val r = c.launchPurchaseFlow(activity, params)
        if (r.responseCode != ResponseCode.RESULT_OK) {
            purchaseCall = null
            call.resolve(result(r))
        }
    }

    // 결제 결과. 기다리는 purchase 호출이 있으면 그쪽으로, 없으면 'purchasesUpdated' 이벤트로 JS에 넘긴다.
    override fun onPurchasesUpdated(r: IapResult, list: List<PurchaseData>?) {
        val data = result(r).put("purchases", remember(list))
        val waiting = purchaseCall
        purchaseCall = null
        if (waiting != null) waiting.resolve(data) else notifyListeners("purchasesUpdated", data)
    }

    // 보유 중(소모성은 consume 전) 구매 목록 - 미처리 구매 복구·복원에 쓴다.
    @PluginMethod
    fun queryPurchases(call: PluginCall) {
        val c = readyClient(call) ?: return
        c.queryPurchasesAsync(typeOf(call)) { r, list -> call.resolve(result(r).put("purchases", remember(list))) }
    }

    @PluginMethod
    fun consume(call: PluginCall) {
        val c = readyClient(call) ?: return
        val (token, p) = purchaseOf(call) ?: return
        c.consumeAsync(ConsumeParams.newBuilder().setPurchaseData(p).build()) { r, _ ->
            if (r.isSuccess) known.remove(token)
            call.resolve(result(r))
        }
    }

    @PluginMethod
    fun acknowledge(call: PluginCall) {
        val c = readyClient(call) ?: return
        val (_, p) = purchaseOf(call) ?: return
        c.acknowledgeAsync(AcknowledgeParams.newBuilder().setPurchaseData(p).build()) { r, _ -> call.resolve(result(r)) }
    }

    // RESULT_NEED_LOGIN -> 원스토어 로그인 화면.
    @PluginMethod
    fun launchLogin(call: PluginCall) {
        val c = client ?: return call.resolve(result(ResponseCode.ERROR_SERVICE_DISCONNECTED, "connect first"))
        c.launchLoginFlowAsync(activity) { r -> call.resolve(result(r)) }
    }

    // RESULT_NEED_UPDATE(서비스 앱 없음/오래됨) -> 설치·업데이트 화면. 끝나면 JS가 connect를 다시 부른다.
    @PluginMethod
    fun launchUpdateOrInstall(call: PluginCall) {
        val c = client ?: return call.resolve(result(ResponseCode.ERROR_SERVICE_DISCONNECTED, "connect first"))
        c.launchUpdateOrInstallFlow(activity) { r -> call.resolve(result(r)) }
    }

    private fun readyClient(call: PluginCall): PurchaseClient? {
        val c = client
        if (c == null || !c.isReady) {
            call.resolve(result(ResponseCode.ERROR_SERVICE_DISCONNECTED, "not connected"))
            return null
        }
        return c
    }

    private fun purchaseOf(call: PluginCall): Pair<String, PurchaseData>? {
        val token = call.getString("purchaseToken").orEmpty()
        val p = known[token]
        if (p == null) {
            call.resolve(result(ResponseCode.ERROR_ILLEGAL_ARGUMENT, "unknown purchaseToken - call queryPurchases first"))
            return null
        }
        return token to p
    }

    private fun typeOf(call: PluginCall) = call.getString("type") ?: ProductType.INAPP

    private fun remember(list: List<PurchaseData>?): JSArray {
        val arr = JSArray()
        list?.forEach {
            known[it.purchaseToken] = it
            arr.put(
                JSObject()
                    .put("orderId", it.orderId)
                    .put("productId", it.productId)
                    .put("purchaseToken", it.purchaseToken)
                    .put("purchaseTime", it.purchaseTime)
                    .put("purchaseState", it.purchaseState)
                    .put("acknowledged", it.isAcknowledged)
                    .put("developerPayload", it.developerPayload)
                    .put("quantity", it.quantity)
            )
        }
        return arr
    }

    private fun result(r: IapResult) = result(r.responseCode, r.message.orEmpty())
    private fun result(code: Int, message: String) = JSObject().put("code", code).put("message", message)
}
