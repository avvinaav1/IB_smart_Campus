/** Public origin used in links people share outside the app (social posts,
 * link previews). Never the current window origin, so sharing from a dev or
 * preview deployment still hands out production links. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ibcampus.icebrkr.space").replace(/\/+$/, "");
