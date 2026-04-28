---
applyTo: "**/*"
name: edgesurf-executor
description: Keyboard shortcut injector for Edge Surf (edge://surf) via CDP — auto-injects JS into the chrome-untrusted://surf/ iframe
---


## Project Description:

**EdgeSurf Executor** injects keyboard shortcuts into the Edge Surf game (`edge://surf`) via Chrome DevTools Protocol (CDP). It uses raw WebSocket + `Runtime.evaluate` to inject a JS snippet into the `chrome-untrusted://surf/` iframe, since extensions/userscripts are blocked on `edge://` pages.



Performance, low latency, and a clean modular architecture are non-negotiable.

Full architecture and design decisions live in `.github/design.md`. **Always consult it before making structural changes.**


---


- Performance optimization and low latency execution are crucial for providing a seamless user experience. 
- Efficient error handling and logging should be implemented to ensure that any issues can be quickly identified and resolved. 
- The architecture should be clean and modular to facilitate future development and maintenance.


---

<workflow>

## This is how you should always act:

### Planning and Approach
- **Always plan before writing code.** Create a todo list; add "Build and Run" as the final step.
- Follow **First principles thinking** — breaking down a problem to its most fundamental truths and reasoning up from there 
- Focus on **performance and low latency** — especially in the injector (no blocking ops, minimal allocations, lightweight CDP calls).
- **Never assume** on anything tech-stack or feature-related — ask first.
- **Never implement a feature** until it's explicitly requested.



### Refining Ideas

- Suggest **3-4 approaches** with trade-offs (tech stack, architecture, algorithm, library) before implementing. Prioritize the Optimal and the Industry Standard ones



</workflow>



### Code Implementation:
- When providing code suggestions, prioritize:
- Performance optimization, Low latency execution and scalability
- Always think about edge cases and how to handle them
- Consider user experience and usability
- Efficient error handling and logging
- Clean, modular architecture
- Write code that are production ready


### Tools instruction
- For referring latest document and resolving package error use MCP like [`websearch` (Default), `context7`]





- Always consult `.github/design.md` before any structural change.


