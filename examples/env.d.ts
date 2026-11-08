// The few Deno globals examples/deno.ts touches, so the examples type-check under Node typings.
declare const Deno:
  | {
      serve(handler: (request: Request) => Response | Promise<Response>): unknown;
      env: { get(name: string): string | undefined };
    }
  | undefined;

interface ImportMeta {
  main?: boolean;
}
