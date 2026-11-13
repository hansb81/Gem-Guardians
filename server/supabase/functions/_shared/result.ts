// 응답·DB 결과 도우미 - auth.ts(service_role 클라이언트)를 안 불러서 테스트가 그냥 import할 수 있다.
export const fail = (reason: string, extra: Record<string, unknown> = {}) => ({ ok: false, reason, ...extra });

// supabase-js { data, error } -> data (error면 던짐 -> handle이 'error'로).
export function must<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error(typeof error === "object" ? JSON.stringify(error) : String(error));
  return data;
}
