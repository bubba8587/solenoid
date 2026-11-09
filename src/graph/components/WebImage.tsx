// [[C103]] untrustedContentSeams, [[B18]] safeToShare
// An image that may come from the web: in a foreign document with no network grant it waits, since loading it is a
// fetch (`live-connections.md` § The network gate). A data: or blob: picture shows at once.
import { useEffect, type CSSProperties } from "react";
import { askNetwork } from "../connectionStore";
import { useNetworkGrant } from "../noteHtml";
import { isWebUrl } from "../webUrl";
import "./WebImage.css";


/** `nodeId` is the card the picture belongs to; `held` is an image value its card held ([[B18]] safeToShare). */
export function WebImage({ src, alt, className, style, nodeId, held: valueHeld }: {
  src: string; alt: string; className?: string; style?: CSSProperties; nodeId?: string; held?: boolean;
}) {
  const allowed = useNetworkGrant(nodeId);
  const held = isWebUrl(src) && (!allowed || valueHeld === true);
  useEffect(() => { if (held) askNetwork(`image:${src}`); }, [held, src]);
  if (held) {
    return (
      <span className={`sol-web-image--held${className ? ` ${className}` : ""}`} style={style} title={src}>
        Web image: it loads once this document is allowed to fetch
      </span>
    );
  }
  return <img className={className} src={src} alt={alt} style={style} draggable={false} />;
}
