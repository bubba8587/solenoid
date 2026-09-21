// [[C93]] gestureByPointerType
/** True on a mobile UA — "Request desktop site" flips it false, which is the lever
 *  users pull to opt OUT of the mobile experience. Its own module so a host that knows its
 *  platform another way (the Obsidian plugin) swaps this one answer. */
export const IS_MOBILE_UA =
  typeof navigator !== "undefined" &&
  ((navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent));
