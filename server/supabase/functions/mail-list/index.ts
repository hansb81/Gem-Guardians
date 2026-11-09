// POST /mail-list -> 우편 목록(최근 50, 받은 것도 claimed로 표시).
import { handle } from "../_shared/http.ts";
import { visibleMail } from "../_shared/mail.ts";

handle("mail-list", async ({ uid }) => ({
  ok: true,
  mail: (await visibleMail(uid)).map((m) => ({
    id: m.id, title: { ko: m.title_ko, en: m.title_en }, bundle: m.bundle,
    expiresAt: m.expires_at ? Date.parse(m.expires_at) : null, claimed: m.claimed,
  })),
}));
