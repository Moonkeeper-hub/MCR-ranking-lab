declare module "katex" {
  interface RenderOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    trust?: boolean;
    strict?: boolean | string;
    output?: string;
  }
  const katex: {
    renderToString(tex: string, options?: RenderOptions): string;
  };
  export default katex;
}
declare module "katex/dist/katex.min.css";
