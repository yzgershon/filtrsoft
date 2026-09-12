# A software business alongside private Filtrsoft

Research date: September 12, 2026. **Recommendation and validation plan, not a launched business or a revenue forecast.** AfterBuild is a working name; availability has not been checked.

## The idea I would test

**AfterBuild: the customer handoff and after-sale support workspace for independent gaming-PC builders.**

Every PC leaves with a private page containing its exact configuration, what was actually tested, included accessories, setup instructions and the builder's stated support terms. When its owner reports a problem later, the support request arrives beside that original record. The builder sees what changed, what is still unknown, and which checks were already tried.

Example: a buyer reports that a previously smooth game now stutters. The workspace shows the delivery configuration, a later customer-supplied system report, and a photo of the display connection. It highlights a changed driver version or display setting as a **difference to investigate**, not a proven cause. The builder selects the next safe check and records its result. The buyer never has to describe an unidentified "gaming computer" from scratch.

The paid outcome is less time reconstructing a machine and repeating basic support questions. Whether it reduces total support time or avoidable returns must be measured with real builders. Selling it does not expose Yish's deal feed, resale margins or sourcing locations.

## Why this avoids the local-deal problem

A cheap local GPU can be bought only once. Adding another person to the same alert feed can reduce the value of everyone else's subscription. AfterBuild works on a different unit: a builder's own delivered computer and its support history. Serving a second builder does not consume the first builder's supply of useful records.

There is still competition, customer acquisition cost and churn. This removes the scarce-inventory conflict; it does not make a software business competition-free. Filtrsoft remains Yish's private buying tool. The commercial product should have separate accounts, storage and branding, with any transfer of a purchase into a support record deliberate and minimal.

## What already exists

| Product | Verified offering | Implication for AfterBuild |
| --- | --- | --- |
| [PC-Doctor Service Center](https://www.pc-doctor.com/images/files/pc-doctor_service_center_17_data_sheet.pdf) | Hardware/driver snapshot comparisons, sessions and customer reports. [Remote plans](https://www.pcdremote.com/register) list $149/year for one concurrent session with remote diagnostics and cloud reporting. | Before/after snapshots are **not a new invention**. A generic diagnostic dashboard has little differentiation. |
| [OCCT Pro](https://www.ocbase.com/occt/pro) | Commercial stress tests, monitoring, benchmarks, CSV/PNG reports and stability certificates; the current page asks businesses to request a quote. | Do not rebuild stress testing or sell an uploaded report as independent certification. Accommodate a builder's existing tools and licenses. |
| [RepairShopr](https://www.repairshopr.com/pricing) | Ticketing, customer portal, invoicing and inventory. Starter lists $69.99 monthly, or $59.99 per month on the annual option, for 75 tickets/invoices and one user. | General repair CRM is crowded. A small builder should be able to adopt one useful handoff without replacing their invoicing system. |
| [BuildCores](https://www.buildcores.com/businesses) | PC visualization and a business API, alongside advertising partnerships. | A polished PC configurator is already a competitive category. Visual novelty alone is a weak reason to pay. |

These are vendor descriptions and published prices, not evidence that customers are dissatisfied or that AfterBuild would outperform them. Product capabilities and prices can change. I have not interviewed buyers, tested paid competitors or verified demand.

## The narrow distinction worth testing

The hypothesis is that small builders need a **delivery-to-support workflow designed around the physical PC and its owner**, lighter than a repair-shop CRM and easier for the buyer than a diagnostic suite.

The builder creates the record once, hands it to the customer, and reuses it in every later conversation. A support case contains the original configuration, symptoms, comparable observations and actual resolution. The customer page explains the setup in plain language and provides a structured way to ask for help.

Start with desktop gaming PCs sold by independent builders handling roughly 5–40 deliveries a month. That volume is an assumed target range to validate, not a measured market segment. A casual seller who builds two PCs a year probably does not need a monthly subscription. Avoid starting with enterprise ITAD, managed IT or every kind of consumer device.

## First product

1. **Delivery record.** Exact component variants, configuration, serial where supplied, included items, seller-entered support terms and a versioned delivery snapshot. Separate reported fields, imported fields and manually checked fields.
2. **Evidence attachments.** Original reports with tool/version, test settings, duration and time. Unsupported file formats stay attachments. A passed test proves only what that test observed under those conditions. A file hash detects later byte changes; it does not prove the report is truthful or belongs to this machine.
3. **Customer page.** Private access, mobile setup guidance and a structured symptom report tied to the correct machine. Sharing and revocation are explicit. A public QR alone must not expose serials, receipts or customer details.
4. **Support comparison.** Delivery versus a later supplied observation, with every changed field traceable to its source. Missing fields mean unknown. Different workloads or tool versions are not comparable performance measurements.
5. **Resolution record.** The builder approves any recommended next step and records what actually fixed the problem. Reuse those resolved cases in future support without claiming correlation is causation.

The first version can accept manually entered specs and existing report uploads. Do not start by distributing a privileged Windows agent. Browser pages cannot reliably inspect a computer's full hardware configuration; a later optional collector needs explicit consent, minimal data collection and a verified update path. No unattended BIOS changes, remote access or automatic stress tests.

The local concept in `docs/prototypes/afterbuild.html` demonstrates the workflow with synthetic records. It does not collect system information, send messages, save customer data or run diagnostics.

## Revenue hypothesis

Test **$29/month for a solo builder**, including up to 15 new handoffs per month and the associated support history; test **$79/month for a small team** only when team work is actually needed. These are proposed experiments, not researched willingness to pay. Keep the buyer's page free.

At $29, a builder valuing time at an assumed $30/hour needs about 58 minutes saved per month to cover the subscription. At five support cases a month that is approximately 12 minutes per case. Measure that against how the builder actually works today. A prettier report without time saved is not enough.

Illustrative scale: 100 solo customers at $29 is $2,900 monthly revenue; 500 is $14,500. That is before hosting, storage, payments, support, acquisition, taxes and churn. The difficult variable is retained paying builders, not the multiplication. Cost limits should include report size, retention and support load before pricing is finalized.

Subscription economics depend on ongoing deliveries or support. If usage proves occasional, test a per-handoff model instead. Do not pretend a static PDF generates recurring value indefinitely, and do not make customers' records disappear just because a builder stops subscribing. Define export and retention up front.

## Validate before building a company around it

Use a two-week, founder-operated experiment:

- Review ten real recent support cases with five builders, with their permission. Record missing information, time spent and existing tools. Ask about the last difficult case rather than whether they like this idea.
- Have three builders use a handoff on actual deliveries. Start with manual records so collector development does not hide weak demand.
- Compare setup time, time to a useful support response, messages per case and repeat usage against their previous workflow. Track failed and inconclusive cases, too.
- Ask for a real paid pilot at the proposed $29 price after they have used it. No purchases, messages or payment collection have been performed by this Codex session.
- Continue only if at least two of the three pilot builders choose to pay and use it again, onboarding stays below about five minutes per handoff, and measured savings plausibly cover the price. These are decision thresholds, not statistical proof. If they already solve this well with PC-Doctor plus their CRM, change or abandon the idea.

The first advantage would be Yish's proximity to hardware buyers and practical support problems. A longer-term advantage could be structured, consented records connecting delivered configurations, observed changes and resolved symptoms. That dataset must come from actual use; there is no existing defensible moat to claim today.

## What to keep separate

Keep local deal discovery private. Do not finance the support product by quietly redistributing Filtrsoft's listings or claims about seller risk. Do not expand immediately into warranties, insurance, escrow, erasure certification or a broad marketplace. Each adds obligations and operational work before this narrow workflow has proved useful.

My recommendation is to test this one paid problem first. It uses Filtrsoft's strongest engineering habit, keeping claims tied to exact evidence, while serving a customer need that does not become less valuable when the next person subscribes.
