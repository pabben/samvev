import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@samvev/core';
import { MAX_SCHOOL_PDF_BYTES, SchoolPdfFetcher } from './pdf-fetcher.ts';

const classPage = 'https://school.example.invalid/class/synthetic';
const pdfUrl = 'https://school.example.invalid/plan.pdf?w=53&v=2';
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const links = '<main><a href="/plan.pdf?w=53&amp;v=2">Synthetic PDF</a></main>';
const publicTarget = { address: '93.184.215.14', family: 4 as const };
const pageResponse = (markup: string) => ({ status: 200, contentType: 'text/html', bytes: Buffer.from(markup) });
const pdfResponse = { status: 200, contentType: 'application/pdf', bytes: pdf };
const rejectedAs = (reason: string) => (error: unknown) =>
  error instanceof DomainError && error.code === 'SCHOOL_PDF_VERIFICATION_FAILED' && error.details?.reason === reason;

test('attests exact link only from approved class HTML and pins each connection', async () => {
  const visited: string[] = [];
  const fetcher = new SchoolPdfFetcher(async () => [publicTarget], async (url, address, signal, maxBytes, type) => {
    assert.deepEqual(address, publicTarget);
    assert.equal(signal.aborted, false);
    visited.push(url.href);
    if (url.href === classPage) {
      assert.ok(maxBytes <= MAX_SCHOOL_PDF_BYTES);
      assert.equal(type, 'text/html');
      return pageResponse(links);
    }
    assert.equal(type, 'application/pdf');
    assert.equal(maxBytes, MAX_SCHOOL_PDF_BYTES);
    return pdfResponse;
  });
  assert.deepEqual(await fetcher.fetch(classPage, pdfUrl), pdf);
  assert.deepEqual(visited, [classPage, pdfUrl]);
});

test('class association rejects missing links, links in inactive markup and ambiguous relative bases', async () => {
  for (const markup of [
    '<a href="/plan.pdf?w=52&amp;v=2">Wrong week link</a>',
    `<!-- ${links} -->`,
    `<script>const fake = '${links}';</script>`,
    `<div data-raw='${links}'></div>`,
    `<template><template>${links}</template>${links}</template>`,
    `${links}<base href="https://other.example.invalid/">`,
  ]) {
    let requests = 0;
    const fetcher = new SchoolPdfFetcher(async () => [publicTarget], async () => {
      requests++;
      return pageResponse(markup);
    });
    await assert.rejects(fetcher.fetch(classPage, pdfUrl), rejectedAs('missing_class_link'));
    assert.equal(requests, 1);
  }
});

test('rejects redirects before following any destination and rejects mixed or rebound private DNS', async () => {
  for (const redirectClassPage of [true, false]) {
    const visited: string[] = [];
    const fetcher = new SchoolPdfFetcher(async () => [publicTarget], async (url) => {
      visited.push(url.href);
      return redirectClassPage || url.href === pdfUrl ? { ...pdfResponse, status: 302 } : pageResponse(links);
    });
    await assert.rejects(fetcher.fetch(classPage, pdfUrl), rejectedAs('redirect_blocked'));
    assert.deepEqual(visited, redirectClassPage ? [classPage] : [classPage, pdfUrl]);
  }
  let lookups = 0;
  let requests = 0;
  const fetcher = new SchoolPdfFetcher(async () => {
    lookups++;
    return lookups === 1 ? [publicTarget] : [publicTarget, { address: '127.0.0.1', family: 4 }];
  }, async () => {
    requests++;
    return pageResponse(links);
  });
  await assert.rejects(fetcher.fetch(classPage, pdfUrl), rejectedAs('url_blocked'));
  assert.equal(requests, 1);
  await assert.rejects(fetcher.fetch(classPage, 'https://other.example.invalid/plan.pdf'), rejectedAs('url_blocked'));
  assert.equal(requests, 1);
});

test('strictly validates MIME, PDF signature and trailer, encoding and byte limit', async () => {
  const scenarios = [
    [{ ...pdfResponse, contentType: undefined }, 'wrong_media_type'],
    [{ ...pdfResponse, contentType: 'text/html' }, 'wrong_media_type'],
    [{ ...pdfResponse, encoding: 'gzip' }, 'wrong_media_type'],
    [{ ...pdfResponse, bytes: Buffer.from('<html>Not a PDF</html>') }, 'invalid_pdf'],
    [{ ...pdfResponse, bytes: Buffer.from('%PDF-1.7\nmissing EOF') }, 'invalid_pdf'],
    [{ ...pdfResponse, bytes: Buffer.alloc(MAX_SCHOOL_PDF_BYTES + 1) }, 'too_large'],
    [{ ...pdfResponse, status: 206 }, 'unavailable'],
  ] as const;
  for (const [response, reason] of scenarios) {
    const fetcher = new SchoolPdfFetcher(async () => [publicTarget], async (url) =>
      url.href === classPage ? pageResponse(links) : response);
    await assert.rejects(fetcher.fetch(classPage, pdfUrl), rejectedAs(reason));
  }
});

test('the deadline covers DNS without allowing a later network request', async () => {
  let requests = 0;
  const fetcher = new SchoolPdfFetcher(() => new Promise((resolve) => {
    setTimeout(() => resolve([publicTarget]), 20);
  }), async () => {
    requests++;
    return pageResponse(links);
  }, 1);
  await assert.rejects(fetcher.fetch(classPage, pdfUrl), rejectedAs('timed_out'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(requests, 0);
});
