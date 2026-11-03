// [[C103]] untrustedContentSeams, [[B18]] safeToShare
// An image that may come from the web: in a foreign document with no network grant it waits, since loading it is a
// fetch (`live-connections.md` § The network gate). A data: or blob: picture shows at once.
import { useEffect, type CSSProperties } from "react";
import { askNetwork } from "../connectionStore";
import { useNetworkGrant } from "../noteHtml";
import "./WebImage.css";

const REMOTE = /^\s*(?:https?:)?\/\//i;

export function WebImage({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  const allowed = useNetworkGrant();
  const held = !allowed && REMOTE.test(src);
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
