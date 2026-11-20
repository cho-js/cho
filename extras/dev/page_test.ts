/**
 * Tests for `page.ts`: the HTML of the page that draws an application. What
 * the page does in a browser is checked by hand; its rules of filtering are
 * tested in `filter_test.ts`.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, isChoError, Module } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { inspect } from "./inspect.ts";
import { graphPage, PAGE_VERSIONS } from "./page.ts";
import { named, shop } from "./testing.ts";

const CDN = "https://cdn.jsdelivr.net/npm";

/** The model a page holds. */
function model_in(html: string): unknown {
  const found =
    /<script type="application\/json" id="cho-graph">(.*?)<\/script>/s
      .exec(html);
  assert.ok(found, "the page has no model");
  return JSON.parse(found[1]!);
}

describe("graphPage", () => {
  it("is a whole HTML page, with the name of the root module as its title", () => {
    const html = graphPage(shop().App);
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<title>App<\/title>/);
    assert.match(html, /<h1>App<\/h1>/);
    assert.match(html, /<\/html>\n$/);
  });

  it("holds the model of the application", () => {
    const { App, created } = shop();
    assert.deepEqual(model_in(graphPage(App)), inspect(App));
    assert.deepEqual(created, []);
  });

  it("takes a model that was read before", () => {
    const graph = inspect(shop().App);
    assert.deepEqual(model_in(graphPage(graph)), graph);
  });

  it("loads the three libraries from the CDN, each at an exact version", () => {
    const html = graphPage(shop().App);
    const urls = [
      `${CDN}/cytoscape@${PAGE_VERSIONS.cytoscape}/dist/cytoscape.min.js`,
      `${CDN}/elkjs@${PAGE_VERSIONS.elkjs}/lib/elk.bundled.js`,
      `${CDN}/cytoscape-elk@${
        PAGE_VERSIONS["cytoscape-elk"]
      }/dist/cytoscape-elk.js`,
    ];
    assert.ok(
      html.includes(
        urls.map((url) => `<script src="${url}"></script>`).join("\n"),
      ),
    );
    for (const version of Object.values(PAGE_VERSIONS)) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
    }
  });

  it("loads them from where the assets option says", () => {
    const html = graphPage(shop().App, { assets: "/static/graph/" });
    assert.ok(
      html.includes(
        '<script src="/static/graph/cytoscape.min.js"></script>\n' +
          '<script src="/static/graph/elk.bundled.js"></script>\n' +
          '<script src="/static/graph/cytoscape-elk.js"></script>',
      ),
    );
    assert.ok(!html.includes(CDN));
  });

  it("has the title that is given, written as text", () => {
    const html = graphPage(shop().App, { title: 'Shop <b>&"1"' });
    assert.ok(html.includes("<title>Shop &lt;b&gt;&amp;&quot;1&quot;</title>"));
    assert.ok(!html.includes("<b>"));
  });

  it("has the switches, the search and the place of the details", () => {
    const html = graphPage(shop().App);
    for (const id of ["provider", "controller", "endpoint"]) {
      assert.ok(
        html.includes(`<input type="checkbox" id="kind-${id}" checked>`),
      );
    }
    assert.ok(html.includes('<input id="search" type="search"'));
    // Where the page puts a switch for each type of endpoint it holds.
    assert.ok(html.includes('<span id="types"></span>'));
    assert.ok(html.includes('<input type="checkbox" id="deps" checked>'));
    assert.ok(html.includes('<input type="checkbox" id="hide">'));
    assert.ok(html.includes('<aside id="details" aria-live="polite">'));
    assert.ok(html.includes('<p id="error" role="alert" hidden>'));
  });

  it("does not let a name of the application be HTML", () => {
    const attack = "</script><script>alert(1)</script><img src=x>";
    const Evil = named(attack);
    Injectable()(Evil);
    const App = named(attack);
    Module({ providers: [Evil] })(App);
    const html = graphPage(App);
    assert.ok(!html.includes(attack));
    assert.ok(!html.includes("<img"));
    // The name is whole in the model, for the page to write as text.
    const graph = loose(model_in(html));
    assert.equal(graph.nodes[0].name, attack);
    assert.equal(graph.nodes[1].name, attack);
    // One model, three libraries and the script of the page: no other script.
    assert.equal(html.match(/<script/g)?.length, 5);
  });

  it("holds the error of a broken application", () => {
    const Mailer = named("Mailer");
    Injectable()(Mailer);
    const Orders = named("Orders");
    Injectable(loose([Mailer]))(loose(Orders));
    const App = named("App");
    Module({ providers: [Orders] })(App);
    const graph = loose(model_in(graphPage(App)));
    assert.equal(graph.error.code, "CHO_CORE_UNRESOLVED_DEPENDENCY");
  });

  it("refuses an option it does not know, and one that is not a string", () => {
    const { App } = shop();
    assert.throws(
      () => graphPage(App, loose({ route: "graph" })),
      (error) =>
        isChoError(error, "CHO_CORE_UNKNOWN_OPTION") &&
        /^graphPage\(\): unknown option "route". Known options: assets, title$/
          .test(error.message),
    );
    assert.throws(
      () => graphPage(App, loose({ title: 5 })),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_OPTION") &&
        error.message === 'graphPage(): "title" must be a string, got 5',
    );
    assert.throws(
      () => graphPage(App, loose(null)),
      (error) => isChoError(error, "CHO_DEV_INVALID_OPTION"),
    );
    assert.throws(
      () => graphPage(loose({})),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("graphPage():"),
    );
  });
});
