# First-run setup

## Goals

The first-run experience must let a non-technical household create a safe, usable installation without editing configuration files. Advanced users may later choose environment variables or automation, but manual configuration is not the primary product path.

## Setup flow

### 1. Welcome and language

- choose interface language
- choose or detect time zone
- explain self-hosted versus managed deployment
- show links to privacy and source-code information

### 2. Claim the installation

- create the installation owner
- configure recovery method
- invalidate the unauthenticated claim flow
- offer multi-factor authentication when supported

### 3. Create the first household

- household name
- default locale and time zone
- optional home name for displays

### 4. Add people

For each person:

- display name or nickname
- optional full birth date; the UI explains that it is personal data and derives age dynamically
- optional age group when an exact birth date is not known
- profile icon or generated avatar
- personal accent token
- whether the person needs a login now
- whether the person is an administrator, adult/member or child/limited member
- password now or a one-time invitation when a login is created

A person profile must be possible without a login, for example a young child represented in schedules and tasks.
An installation owner can also choose Household administrator directly in this
flow. Administrator roles enable login setup and show their fixed capability
set before the person is saved. Assigning another installation owner requires
an explicit confirmation.

### 5. Review permissions

The wizard presents plain-language choices such as:

- Can create AI monitoring tasks
- Can publish directly to shared displays
- Can schedule messages
- Can claim household tasks
- Can approve completed tasks
- Can run selected Homey actions
- Can manage integrations

The final effective permissions are stored as capabilities, not inferred only from age.

### 6. Choose the visual starting point

- select one of the supported layout concepts
- choose light, dark or automatic appearance
- choose information density
- preview iPhone, shared display and compact wall panel

### 7. Pair the first display

The display opens a pairing page and presents a short-lived code. The administrator enters the code and chooses:

- display name
- room/location
- locale
- allowed household information
- permitted actions
- screen schedule and privacy mode

### 8. Optional integrations

Connections can be skipped:

- Homey
- AI provider or local AI endpoint
- Home Assistant
- calendars

Each connection receives only selected capabilities. The wizard must offer a test operation and clear failure explanation.

### 9. Test the household loop

The wizard creates no hidden permanent automation. Instead it guides the user through:

1. send a test message
2. confirm it appears on the display
3. optionally send a Homey notification
4. preview a sample AI task without activating external monitoring
5. remove demonstration content

## Example-data mode

Developers, reviewers and prospective users must be able to launch Samvev with synthetic people, messages and schedules. Example data must never resemble or contain the maintainer's real household data.
Synthetic/demo households are marked separately from live households and are
never merged into a live household by the local bootstrap transition.

## Recovery and repeatability

- Setup progress can resume after a browser interruption.
- Integration failure does not discard completed household setup.
- The owner can export a sanitized diagnostic report.
- Infrastructure automation can invoke a documented non-interactive bootstrap path later, but it must protect secrets and ownership claim tokens.
