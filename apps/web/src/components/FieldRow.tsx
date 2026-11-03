import type { Field } from "@mockgen/core";
import { issuesAt, newField, removeAt, updateAt, type FieldPath } from "../fieldTree.ts";
import type { EditorCtx } from "./FieldList.tsx";
import { OptionsEditor } from "./OptionsEditor.tsx";
import { TypePicker } from "./TypePicker.tsx";

export function FieldRow({ field, path, ctx, onDragStart, onDragEnd }: {
  field: Field;
  path: FieldPath;
  ctx: EditorCtx;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const errors = issuesAt(ctx.issues, path);
  const type = ctx.typeByKey.get(field.type);
  const set = (patch: Partial<Field>) => ctx.setFields(updateAt(ctx.root, path, patch));

  const changeType = (key: string) => {
    const kind = ctx.typeByKey.get(key)?.kind;
    const nests = kind === "object" || kind === "array";
    set({ type: key, options: {}, children: nests ? (field.children?.length ? field.children : [newField([])]) : undefined });
  };

  return (
    <div className="field-row" data-testid="field-row">
      <span
        className="handle"
        draggable
        title="Drag to reorder"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", field.name);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ⠿
      </span>
      <label>
        <input aria-label="Field name" value={field.name} onChange={(e) => set({ name: e.target.value })} />
        {errors.name && <small className="error">{errors.name}</small>}
      </label>
      <div>
        <TypePicker value={field.type} types={ctx.types.types} onChange={changeType} />
        {errors.type && <small className="error">{errors.type}</small>}
      </div>
      <div>
        {type && (
          <OptionsEditor type={type} options={field.options} onChange={(options) => set({ options })} errors={errors} schemas={ctx.schemas} />
        )}
        {errors.children && <small className="error">{errors.children}</small>}
      </div>
      <label className="blank">
        <input
          aria-label="Blank %"
          type="number"
          min={0}
          max={100}
          value={field.blankPercent}
          onChange={(e) => set({ blankPercent: Number(e.target.value) })}
        />
        % blank
        {errors.blankPercent && <small className="error">{errors.blankPercent}</small>}
      </label>
      <button type="button" className="icon" aria-label="Remove field" onClick={() => ctx.setFields(removeAt(ctx.root, path))}>
        ✕
      </button>
    </div>
  );
}
