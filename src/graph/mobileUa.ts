// [[C93]] gestureByPointerType
/** "Request desktop site" flips it false, which is how users opt out of the mobile experience. Its own module so a
 *  host that knows its platform another way (the Obsidian plugin) swaps this one answer. */
export const IS_MOBILE_UA =
  typeof navigator !== "undefined" &&
  ((navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent));
