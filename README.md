# Pomelo

This is the first limited version of Pomelo. It's scope is only to provide QOL features, no moderation.
Moderation features are not included in this version. This is an ALPHA version, expect bugs and issues.
Compared to other bots like Dyno, it uses more modern APIs like ephemeral messages and paginated embeds.

## Features

- [x] Basic AFK
- [x] Advanced AFK\*
- [x] Paginated AFK Messages
- [x] AFK Google Calendar Integration
- [x] Blocks AFK pings using AutoMod
- [ ] Moderation features

### Disclaimer - Google Calendar

I'm still waiting on OAuth verification from Google, so you may get a "Google hasn't verified this app" warning before signing in. (+100 user max limit)

## Differences

|                        | Pomelo | Dyno |
| ---------------------- | ------ | ---- |
| AFK                    | Yes    | Yes  |
| Advanced AFK\*         | Yes    | No   |
| Paginated AFK Messages | Yes    | No   |
| AFK AutoMod            | Yes    | No   |

\*Being able to set a message, duration and attachment.

## A story, a goal and a plan

This project starts with Pomegranate, a bot I created for [Lemomeme](https://discord.gg/memenade) and [HOV](https://discord.gg/hov) (>100k members combined). It works well for their usecase but it made me realise that I wanted a more modern bot, with more features and a better architecture; that wasn't private like Pomegranate. Pomelo is essentially the next step of Pomegranate.

So the launch plan is split into 3 phases:

1. Alpha - QOL features, no moderation
2. Beta - Moderation features
3. Stable - All features at a stable state

## The stack

Pomelo's stack is a bit different from the meta. It uses a dual-database system, with Redis for high-frequency data and a libSQL (Turso) database for other data. This allows for faster data access and lower latency, while minimising cost.

It's also built using Sapphire, a modern framework for Discord bots. It's built on top of Discord.js and provides a lot of features out of the box, such as i18n, pagination, and more.

## Use of Artificial Intelligence

AI was used to generate some of the code in this project. Mainly using Windsurf for autocomplete and some refactoring, and Claude for some code generation. Either way, all AI generated code was double-checked (and probably re-written tbh).

## Privacy Policy

The privacy policy can be found [on the website](https://pom.kdv.one/privacy).

## License

This version of Pomelo is licensed under the Mozilla Public License 2.0. See the LICENSE file for more information.
