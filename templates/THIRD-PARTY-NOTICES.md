# Third-party notices

{{APP_NAME}} includes the following third-party components. Each remains under its own licence.

Fill one block per component. Apache-2.0 and MIT both require you to reproduce the licence text and
the copyright line; copying the upstream `LICENSE` file verbatim into this document satisfies that.

---

## {{COMPONENT_NAME}}

- **Version:** {{VERSION}}
- **Source:** {{URL}}
- **Licence:** {{LICENCE}}
- **How it is used:** {{static library | bundled binary invoked as a separate process | model weights | data files}}

```
{{PASTE THE FULL UPSTREAM LICENCE TEXT HERE}}
```

---

## Checklist before shipping

- [ ] Every bundled library, model file, font, icon set and data directory appears above.
- [ ] No component is under GPL, LGPL, AGPL, or a non-commercial licence unless you have confirmed
      how it is linked and accepted the consequences. Static linking of GPL code into a closed-source
      binary is not permitted; running a separate GPL program that the user installed themselves is.
- [ ] Model weights: check the upstream model card for a licence. Many speech and language models are
      CC BY-NC (non-commercial) even when the surrounding code is Apache-2.0.
- [ ] Apple platforms: this file should also be reachable inside the app, for example from an
      Acknowledgements item in the Settings or Help menu.
