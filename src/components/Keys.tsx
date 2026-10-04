import { Fragment } from "react";

/** A shortcut as its keys, a plus between them. */
export function Keys({ parts }: { parts: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((key, i) => (
        <Fragment key={i}>
          {i > 0 && "+"}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
