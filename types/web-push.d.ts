/**
 * `web-push` ships no types and `@types/web-push` is not installed.
 *
 * ⚠ THIS DECLARES ONLY WHAT `src/api/alerts.ts` ACTUALLY CALLS. A blanket
 * `declare module "web-push";` would type the whole library as `any`, which
 * silences the error and every future mistake with it — a typo in
 * `sendNotification` would then compile.
 */
declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface VapidKeys { publicKey: string; privateKey: string }
  export interface SendResult { statusCode: number; body: string; headers: Record<string, string> }
  export function generateVAPIDKeys(): VapidKeys;
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: Record<string, unknown>,
  ): Promise<SendResult>;
}
