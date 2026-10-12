import type { ProxyOptions } from "vite";

/** Propagate a premature browser response close across the development proxy. */
export function localApiProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (upstream, _request, response) => {
        const cancel = () => {
          if (!response.writableFinished && !upstream.destroyed) upstream.destroy();
        };
        const detach = () => {
          response.off("close", cancel);
          response.off("finish", detach);
        };
        response.once("close", cancel);
        response.once("finish", detach);
        upstream.once("close", detach);
        if (response.destroyed) cancel();
      });
    },
  };
}
