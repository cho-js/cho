/**
 * Tests for `page.ts`: the HTML of the page that shows a document, for each
 * of the ready clients and for a client of the application's own.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { docsPage, UI_VERSIONS } from "./page.ts";

const URL = "/docs/openapi.json";
const CDN = "https://cdn.jsdelivr.net/npm";

describe("docsPage", () => {
  it("is a whole HTML page, with the title", () => {
    const html = docsPage({ url: URL, title: "Shop" });
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<title>Shop<\/title>/);
    assert.match(html, /<\/html>\n$/);
    // the default title
    assert.match(docsPage({ url: URL }), /<title>API<\/title>/);
  });

  it("shows Swagger UI by default, from the CDN, at an exact version", () => {
    const html = docsPage({ url: URL });
    const base = `${CDN}/swagger-ui-dist@${UI_VERSIONS.swagger}`;
    assert.ok(
      html.includes(`<link rel="stylesheet" href="${base}/swagger-ui.css">`),
    );
    assert.ok(
      html.includes(`<script src="${base}/swagger-ui-bundle.js"></script>`),
    );
    assert.ok(
      html.includes(
        'SwaggerUIBundle({ url: "/docs/openapi.json", dom_id: "#swagger-ui" })',
      ),
    );
    assert.ok(html.includes('<div id="swagger-ui"></div>'));
    assert.equal(docsPage({ url: URL, ui: "swagger" }), html);
  });

  it("shows Scalar", () => {
    const html = docsPage({ url: URL, ui: "scalar" });
    const base = `${CDN}/@scalar/api-reference@${UI_VERSIONS.scalar}`;
    assert.ok(
      html.includes(
        `<script src="${base}/dist/browser/standalone.js"></script>`,
      ),
    );
    assert.ok(
      html.includes(
        'Scalar.createApiReference("#app", { url: "/docs/openapi.json" })',
      ),
    );
    assert.ok(html.includes('<div id="app"></div>'));
  });

  it("shows Redoc", () => {
    const html = docsPage({ url: URL, ui: "redoc" });
    const base = `${CDN}/redoc@${UI_VERSIONS.redoc}`;
    assert.ok(html.includes('<redoc spec-url="/docs/openapi.json"></redoc>'));
    assert.ok(
      html.includes(
        `<script src="${base}/bundles/redoc.standalone.js"></script>`,
      ),
    );
  });

  it("has exact versions", () => {
    assert.deepEqual(Object.keys(UI_VERSIONS), ["swagger", "scalar", "redoc"]);
    for (const version of Object.values(UI_VERSIONS)) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
    }
  });

  it("loads the files of the client from where the application says", () => {
    const swagger = docsPage({ url: URL, assets: "/static/swagger-ui/" });
    assert.ok(swagger.includes('href="/static/swagger-ui/swagger-ui.css"'));
    assert.ok(
      swagger.includes('src="/static/swagger-ui/swagger-ui-bundle.js"'),
    );
    assert.equal(swagger.includes("jsdelivr"), false);
    const scalar = docsPage({
      url: URL,
      ui: "scalar",
      assets: "https://assets.example.com/scalar",
    });
    assert.ok(
      scalar.includes(
        'src="https://assets.example.com/scalar/dist/browser/standalone.js"',
      ),
    );
    const redoc = docsPage({ url: URL, ui: "redoc", assets: "/redoc" });
    assert.ok(redoc.includes('src="/redoc/bundles/redoc.standalone.js"'));
  });

  it("escapes the title, the URL and the assets", () => {
    const title = `</title><script>alert(1)</script>`;
    const url = `/docs/"x"</script><script>alert(2)</script>&a=1`;
    const assets = `"><script>alert(3)</script>`;
    for (const ui of ["swagger", "scalar", "redoc"] as const) {
      const html = docsPage({ url, ui, title, assets });
      assert.equal(html.includes("<script>alert("), false, ui);
      assert.ok(
        html.includes(
          "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>",
        ),
        ui,
      );
      assert.ok(html.includes("&quot;&gt;&lt;script&gt;alert(3)"), ui);
    }
    // in a script, the URL is a string of JavaScript with no `<`
    const LT = String.fromCharCode(92) + "u003c";
    const swagger = docsPage({ url, ui: "swagger" });
    assert.ok(
      swagger.includes(
        `url: "/docs/\\"x\\"${LT}/script>${LT}script>alert(2)${LT}/script>&a=1"`,
      ),
    );
    // line separators would end a line of the script
    const lines = docsPage({
      url: `/a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`,
    });
    assert.ok(
      lines.includes(
        `url: "/a${String.fromCharCode(92)}u2028b${
          String.fromCharCode(92)
        }u2029c"`,
      ),
    );
    // in an attribute, it is escaped as HTML
    const redoc = docsPage({ url, ui: "redoc" });
    assert.ok(
      redoc.includes(
        'spec-url="/docs/&quot;x&quot;&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;&amp;a=1"',
      ),
    );
  });

  it("gives a function of the application the URL and the title", () => {
    const seen: unknown[] = [];
    const html = docsPage({
      url: URL,
      title: "Shop",
      assets: "/ignored",
      ui: (page) => {
        seen.push(page);
        return `<my-client spec="${page.url}"></my-client>`;
      },
    });
    assert.equal(html, '<my-client spec="/docs/openapi.json"></my-client>');
    assert.deepEqual(seen, [{ url: URL, title: "Shop" }]);
  });

  it("needs a URL", () => {
    const message =
      'docsPage(): the "url" option is required: where the OpenAPI document is';
    assert.throws(() => docsPage(loose({})), { message });
    assert.throws(() => docsPage(loose({ url: "" })), { message });
    assert.throws(() => docsPage(loose(undefined)), { message });
  });

  it("names an unknown client, and the known ones", () => {
    assert.throws(() => docsPage(loose({ url: URL, ui: "rapidoc" })), {
      message:
        'docsPage(): unknown ui "rapidoc". Known: redoc, scalar, swagger, or a function that returns the HTML',
    });
    // `false` is for the routes: a page has a client
    assert.throws(() => docsPage(loose({ url: URL, ui: false })), {
      message:
        "docsPage(): unknown ui false. Known: redoc, scalar, swagger, or a function that returns the HTML",
    });
    // not a property of an object
    assert.throws(() => docsPage(loose({ url: URL, ui: "toString" })), {
      message: /unknown ui "toString"/,
    });
  });
});
