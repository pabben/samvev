# Contributing to Samvev

Samvev welcomes contributions from developers, designers, translators, testers, security reviewers and documentation writers.

## Before contributing

1. Read the [vision](docs/VISION.md), [product requirements](docs/PRODUCT_REQUIREMENTS.md) and [roadmap](docs/ROADMAP.md).
2. Search existing issues before creating a new one.
3. Use GitHub Discussions for broad exploration and issues for work with a clear outcome.
4. Do not include real household data, children's names, schedules, addresses, access tokens or screenshots from private systems.
5. For a substantial change, begin with an issue and agree on scope before implementing it.

## Contribution workflow

1. Fork the repository.
2. Create a focused branch from the default branch.
3. Make one coherent change.
4. Add or update tests and documentation.
5. Run available checks locally.
6. Sign every commit using the Developer Certificate of Origin:

```bash
git commit -s -m "Describe the change"
```

7. Open a pull request using the repository template.

## Design contributions

A design proposal should show its behavior on all relevant surfaces:

- iPhone
- at least one iPhone widget size when applicable
- shared family display
- compact Shelly Wall Display XL or equivalent wall-panel mode when applicable
- light and dark appearance

Design proposals must prioritize distance readability, touch targets, privacy on shared screens and meaningful hierarchy over decorative density.

## Translation contributions

- User-facing strings must use translation keys.
- Norwegian Bokmål (`nb`) and English (`en`) are the initial reference locales.
- Do not encode names, dates, units or gender assumptions into translatable strings.
- Include screenshots or tests for unusually long translations when possible.

## AI-generated contributions

AI-assisted work is welcome, but the contributor remains responsible for correctness, licensing, security and tests. Do not submit generated code or text that you cannot review and explain.

Pull requests should disclose material AI assistance when it affected architecture, security-sensitive code or large generated sections.

## Security-sensitive changes

Do not open a public issue for an unpatched vulnerability. Follow [SECURITY.md](SECURITY.md).

## Review expectations

Maintainers may ask for:

- smaller scope
- threat-model updates
- migration or rollback plans
- evidence that permissions are enforced server-side
- accessibility checks
- source and uncertainty handling for AI-derived content

## Licensing and sign-off

By contributing, you agree that your contribution is made under the applicable license for the files you modify and that your DCO sign-off is accurate. See [DEVELOPER_CERTIFICATE_OF_ORIGIN.md](DEVELOPER_CERTIFICATE_OF_ORIGIN.md).
