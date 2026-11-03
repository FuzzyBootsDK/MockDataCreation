import { useState } from "react";
import type { Field, FieldTypeInfo, Schema, ValidationIssue } from "@mockgen/core";
import type { TypesInfo } from "../api.ts";
import { appendTo, getAt, moveWithin, newField, type FieldPath } from "../fieldTree.ts";
import { FieldRow } from "./FieldRow.tsx";

export interface EditorCtx {
  root: Field[];
  setFields(fields: Field[]): void;
  types: TypesInfo;
  typeByKey: Map<string, FieldTypeInfo>;
  schemas: Schema[];
  issues: ValidationIssue[];
}

export function FieldList({ parentPath, ctx }: { parentPath: FieldPath; ctx: EditorCtx }) {
  const list = parentPath.length ? (getAt(ctx.root, parentPath)?.children ?? []) : ctx.root;
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  return (
    <div className={parentPath.length ? "nested" : undefined}>
      {list.map((field, i) => {
        const path = [...parentPath, i];
        const kind = ctx.typeByKey.get(field.type)?.kind;
        return (
          <div
            key={i}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.stopPropagation();
              if (dragFrom !== null && dragFrom !== i) ctx.setFields(moveWithin(ctx.root, parentPath, dragFrom, i));
              setDragFrom(null);
            }}
          >
            <FieldRow field={field} path={path} ctx={ctx} onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)} />
            {(kind === "object" || kind === "array") && <FieldList parentPath={path} ctx={ctx} />}
          </div>
        );
      })}
      <button type="button" className="add-field" onClick={() => ctx.setFields(appendTo(ctx.root, parentPath, newField(list)))}>
        + Add {parentPath.length ? "nested field" : "another field"}
      </button>
    </div>
  );
}
