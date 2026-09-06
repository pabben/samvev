# Product vision

## One sentence

Samvev lets people describe what information matters, turns that intent into durable monitoring and briefing tasks, and delivers trustworthy messages and actions to the right people and screens.

## The problem

Families and small groups spread important information across school pages, PDFs, calendars, Spond, email, notes, smart-home systems, chats and individual memory. Existing dashboards can display data, and AI assistants can answer a question, but neither reliably completes the whole recurring workflow:

1. understand what a person wants monitored
2. remember the instruction as a durable rule
3. check sources at the right time
4. detect actual changes without unnecessary AI calls
5. interpret only what needs interpretation
6. preserve the original source and uncertainty
7. route the result according to permissions
8. make the result visible where the household will act on it

## Product promise

A person should be able to say:

> Follow this page. Tell the household each morning what matters today. Alert me immediately if a new document changes what we must bring.

Samvev should show the resulting rule before activation, run it predictably, explain failures and allow the user to pause or edit it.

## Who it is for

The initial focus is a household with adults, children, shared screens and a mix of technical and non-technical users. The architecture should later support co-parenting across homes, shared housing and other small groups without making family-specific assumptions in the core data model.

## What makes Samvev different

- Natural language creates inspectable automation rather than hidden assistant memory.
- Notifications, source evidence and shared displays use one common event model.
- Homey is supported directly; Home Assistant is optional.
- The self-hosted product remains complete.
- AI can be cloud-hosted, local or disabled for non-AI functions.
- Personal and household scopes are separate by design.
- Design targets mobile, distance viewing and compact wall panels from the beginning.

## What Samvev is not

- a generic chatbot wrapper
- a school-only product
- a replacement for Homey, Home Assistant or calendar providers
- an autonomous system allowed to perform safety-sensitive actions without explicit policies
- a public social network
- a system that treats an AI summary as more authoritative than its source

## Success for the first household pilot

The pilot succeeds when:

- several household members can sign in with different permissions
- a child can schedule a message for the kitchen display
- an adult can create a durable monitor using natural language
- a web/PDF source can be checked and changes detected deterministically
- an AI summary retains its original source and confidence state
- the shared display updates without manual refresh
- the administrator receives a Homey notification
- an iPhone widget shows the next relevant item
- the interface is usable in light and dark appearance
- no private information crosses user or display boundaries
