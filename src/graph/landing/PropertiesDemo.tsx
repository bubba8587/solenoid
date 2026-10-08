// [[C107]] obsidianPlugin, [[B3]] sameNodeEverywhere
import { useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import noteText from "../../../demo-vault/Solenoid/Property types.md?raw";
import vaultTypes from "../../../demo-vault/.obsidian/types.json";
import { PropertyChip } from "../../../obsidian-plugin/src/PropertyChip";
import { PROPERTY_KINDS } from "../../../obsidian-plugin/src/yamlValue";
import { SocketComponent } from "../components/SocketComponent";
import { SolenoidSocket, type SocketDataType } from "../sockets";

const KIND_BY_ID = new Map(PROPERTY_KINDS.map((k) => [k.id, k]));
const cssVar = (token: string) => `var(${token})`;

function noteProperties(): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(noteText);
  return (m ? parse(m[1]) : {}) as Record<string, unknown>;
}

export function PropertiesDemo() {
  const [props, setProps] = useState(noteProperties);
  const rows = useMemo(() => {
    const types = vaultTypes.types as Record<string, string>;
    return Object.keys(noteProperties()).flatMap((key) => {
      const kind = KIND_BY_ID.get(types[key]);
      if (!kind || kind.shape === "scalar") return [];
      return [{ key, kind, socket: new SolenoidSocket(kind.id.slice("solenoid-".length) as SocketDataType) }];
    });
  }, []);
  const yamlText = useMemo(() => `---\n${stringify(props)}---`, [props]);

  return (
    <div className="obs-props">
      <div className="obs-props__panel">
        <div className="obs-props__head">Properties</div>
        {rows.map(({ key, kind, socket }) => (
          <div key={key} className="obs-props__row">
            <span className="obs-props__icon"><SocketComponent data={socket} /></span>
            <span className="obs-props__key">{key}</span>
            <span className="obs-props__value">
              <PropertyChip
                kind={kind}
                label={key}
                initial={props[key]}
                resolveToken={cssVar}
                onChange={(next) => setProps((p) => ({ ...p, [key]: next }))}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="obs-props__yaml-box">
        <pre className="obs-yaml obs-props__yaml">{yamlText}</pre>
      </div>
    </div>
  );
}
