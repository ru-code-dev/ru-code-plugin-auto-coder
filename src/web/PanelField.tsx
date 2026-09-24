import type { ReactNode } from "react";

export function PanelField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="font-medium text-foreground text-xs">{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : (
        <span className="text-[11px] text-muted-foreground">{props.hint}</span>
      )}
    </label>
  );
}

export function PanelFieldError(props: { readonly children: ReactNode }) {
  return <span className="text-[11px] text-destructive">{props.children}</span>;
}
