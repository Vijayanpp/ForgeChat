import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/meta-api";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const MEDIA_PATH_RE = /\/api\/whatsapp\/media\/([^/?#]+)/;

/** Extract Meta media id from our inbox proxy path. */
export function parseWhatsAppMediaId(mediaUrl: string): string | null {
  const match = mediaUrl.match(MEDIA_PATH_RE);
  return match?.[1] ?? null;
}

/**
 * Download a customer-sent WhatsApp image server-side for OpenAI vision.
 * Returns a base64 data URL the model can read directly.
 */
export async function downloadWhatsAppImageDataUrl(
  accountId: string,
  mediaUrl: string,
): Promise<string | null> {
  const mediaId = parseWhatsAppMediaId(mediaUrl);
  if (!mediaId) return null;

  const db = supabaseAdmin();
  const { data: config, error: configErr } = await db
    .from("whatsapp_config")
    .select("access_token")
    .eq("account_id", accountId)
    .maybeSingle();

  if (configErr || !config?.access_token) return null;

  try {
    const accessToken = decrypt(config.access_token as string);
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    });
    const mime =
      contentType || mediaInfo.mimeType || "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("[ai/vision] failed to download media:", err);
    return null;
  }
}
