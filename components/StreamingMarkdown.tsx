"use client";

import { Streamdown } from "@lobehub/streamdown";
import { memo, useState } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import { useReducedMotion } from "@/hooks/useStreamingMarkdown";
import { needsWholeMarkdownDocument } from "@/lib/streaming-markdown";
import { useChatEffect } from "@/hooks/useChatEffects";
import { useStreamReveal } from "@/hooks/useStreamReveal";

const completionOptions = {
  htmlTags: false,
  inlineKatex: false,
  linkMode: "text-only",
} as const;

type Props = Omit<Options, "children"> & { children: string; isStreaming?: boolean };

/** A headless stream engine; Pi still owns the syntax plugins and all widgets. */
function AnimatedMarkdown({ children, ...options }: Omit<Props, "isStreaming">) {
  const reducedMotion = useReducedMotion();
  // A reconnect or in-place edit can replace a stream. Remount its queue during
  // render so even the first paint cannot contain the previous answer's text.
  const [input, setInput] = useState({ text: children, generation: 0 });
  const generation = input.generation + (children.startsWith(input.text) ? 0 : 1);
  if (children !== input.text) setInput({ text: children, generation });
  if (reducedMotion) {
    return <ReactMarkdown {...options}>{children}</ReactMarkdown>;
  }

  return (
    <Streamdown
      {...options}
      key={generation}
      content={children}
      granularity="word"
      smoothing="realtime"
      remend={completionOptions}
    />
  );
}

export const StreamingMarkdown = memo(function StreamingMarkdown({ children, isStreaming, ...options }: Props) {
  const enabled = useChatEffect("streamReveal") === "on";
  const wholeDocument = needsWholeMarkdownDocument(children);
  // Keep Streamdown’s block cache and pacing, but own one consistent reveal
  // duration for both ordinary Markdown and whole-document fallbacks.
  const revealRef = useStreamReveal(Boolean(isStreaming));
  return <div ref={revealRef} className={isStreaming && enabled ? "chat-stream-reveal" : undefined}>{!isStreaming || !enabled || wholeDocument
    ? <ReactMarkdown {...options}>{children}</ReactMarkdown>
    : <AnimatedMarkdown {...options}>{children}</AnimatedMarkdown>}</div>;
});
