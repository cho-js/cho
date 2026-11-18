# A Cloudflare Worker with CHO

`src/index.ts` is a Worker built on `@chojs/web`: the built-in router, a
binding read by a provider, and work after the answer with `waitUntil`.

```sh
cd examples/worker
npx wrangler dev
curl "http://localhost:8787/hello?name=you"   # {"message":"Hello, you"}
curl "http://localhost:8787/visits"           # {"visits":1}
```

In this repository the packages come from the folders beside it: `tsconfig.json`
has their paths. In an application of your own, install them
(`npx jsr add @chojs/web`), and no `tsconfig.json` is needed for that.
