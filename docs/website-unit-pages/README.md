# Unit pages for purplebox.ae

On the WhatsApp unit-sizes carousel, each card has a box above its text with the
title and web address of the page "Book now" opens. These eight small pages make
that box read the unit size ("10 sq ft storage unit") with **purplebox.ae**
under it. Each page sends the visitor straight on to that unit on
`unit-details.html`, so nobody sees the page itself.

## Upload

Put the files in `units/` on the website exactly as named, so they open at:

| File | Address | Opens |
|---|---|---|
| `units/xs.html` | https://purplebox.ae/units/xs.html | 10 sq ft (`#unit-xs`) |
| `units/ss.html` | https://purplebox.ae/units/ss.html | 25 sq ft (`#unit-ss`) |
| `units/m35.html` | https://purplebox.ae/units/m35.html | 35 sq ft (`#unit-m35`) |
| `units/s50.html` | https://purplebox.ae/units/s50.html | 50 sq ft (`#unit-s50`) |
| `units/m75.html` | https://purplebox.ae/units/m75.html | 75 sq ft (`#unit-m75`) |
| `units/l.html` | https://purplebox.ae/units/l.html | 100 sq ft (`#unit-l`) |
| `units/xl.html` | https://purplebox.ae/units/xl.html | 150 sq ft (`#unit-xl`) |
| `units/xxl.html` | https://purplebox.ae/units/xxl.html | 200 sq ft (`#unit-xxl`) |

They are plain HTML with no styles or scripts to load, and carry no prices, so
they never need updating when prices change. They are marked `noindex` so
Google does not list them.

The CRM checks the pages before sending the carousel to Meta: "Send to Meta"
says which ones are missing until all eight are live.

The files are generated from `server/src/services/carousel.js` (`cardLinkPage`);
a test checks they still match.
