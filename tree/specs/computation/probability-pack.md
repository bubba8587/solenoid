---
aliases: ["Probability pack"]
tags: [spec, computation]
---
<!-- [[B15]] leanCore, [[C79]] packActivationIsPresentation, [[D96]] emptySlotShowsItsValue, [[C118]] formatTravelsWithValue -->

# Spec: Probability pack

Serves [[B15]] leanCore. It covers what the Probability pack's three nodes compute, what their cards draw, and why each method was chosen.

The Probability pack (`packs/probability.ts`, off by default, group Analysis) holds three nodes that each answer a question about uncertainty and draw the distribution behind the answer: Probability Between, A/B Test and Bootstrap. The node classes are in `nodes/probability.ts`, their bodies in `crates/solenoid-core/src/nodes/probability.rs` ([[node-bodies]]), and their cards in `components/ProbabilityBetweenNode.tsx`, `AbTestNode.tsx` and `BootstrapNode.tsx`, which share the picture strip in `components/probabilityPlot.tsx`. The pack's example seed is `seedGraphs/packs/pack-probability.json`.

## The pictures

Each card draws a strip from points its body shows on the node (`plotX` with `plotY`, or `plotA` and `plotB`); a card never computes a curve itself ([[components#The rules]]). The answer's range is in the card's accent, filled as a translucent wash under a curve or as solid columns, and the rest of the distribution is neutral. The strips carry no axes, ticks or captions: the numbers are in the input and output rows directly above and below, so a label on the picture would repeat them. The A/B Test strip names its two curves with a bare "A" and "B" at their peaks, the one piece of text a picture needs to be read.

## Percents

Probability Between's answer and all four A/B Test outputs show as percents: each card authors a `percent` display format on those outputs (`annotationFor`), which travels downstream with the value as any format does ([[C118]] formatTravelsWithValue). The value itself stays the fraction, so a formula reading B beats A computes with 0.9245, not 92.45, and a docked Format Controller overrides the percent like any other format. A lift is a fraction of A's rate, so it shows as a percent too. Bootstrap's outputs are in the list's own units and carry no format of their own.

## Probability Between

The Probability Between node answers the probability that a value from a chosen distribution lands between Low and High. Its op is the family: Normal, Student's t, Chi-squared, F, Beta, Gamma, Lognormal, Weibull, Exponential, Binomial, Poisson, Hypergeometric and Negative Binomial, with the parameter sockets, labels and starting values of the Distributions node's `DIST_SPECS`. The Distributions node's Standard Normal, φ and Gauss entries are left out, since Normal with mean 0 and stdev 1 is the standard normal and the other two are forms rather than families.

- **The answer.** For a continuous family the node answers `CDF(High) − CDF(Low)`. For a counting family it answers the probability of the whole numbers from `ceil(Low)` to `floor(High)`, both ends included, which is 0 when no whole number lies between them. The CDFs are the Distributions node's kernels (`dists::compute`), so the two nodes can't disagree.
- **Empty ends.** Low left empty is −∞ and High left empty is ∞, each shown as a Behavior (`[−∞]`, `[∞]`). Ends given in the wrong order are read as the range between them, and dragging one handle past the other swaps the two fields when the drag ends, so Low never reads above High.
- **Errors.** A parameter outside its family's domain answers `#DOMAIN!`, as the Distributions node does. A wired blank parameter blanks the answer.
- **The drag.** The strip draws the family from its 0.1% to its 99.9% quantile, reaching out to a finite end of the family's range when that end is close (for a counting family, while every whole number still fits the picture's columns; otherwise within a quarter of the drawn width), so Binomial's 0 and n and Chi-squared's 0 are always drawn and reachable. It draws as a curve for a continuous family and as columns for a counting one (sampled evenly when the range holds more than 161 whole numbers, then drawn as a curve). Two handles mark Low and High. A little room is left past each end so a handle at the last value shows whole, and a drag stops at the first and last drawn values. A press anywhere in the strip takes the nearer unwired handle and moves it to the pointer; the value snaps to a whole number for a counting family and to about 1/200 of the drawn range otherwise. Over columns a handle sits on the outer edge of the last column it takes in, so every column is plainly in or out. The answer recomputes once per animation frame while dragging. A right-click on a handle empties that end. A wired end's handle draws faded and can't be dragged, since the cable owns the value.
- **A family switch** drops the departing parameter sockets' cables first ([[input-cable-pruning]]) and moves both handles to that family's starting range (Normal starts at −1 to 1, about 68%), since the old range would usually sit off the new curve.

## A/B Test

The A/B Test node compares two versions from their visitors and conversions and answers four numbers: B beats A, the probability that B's true conversion rate is higher than A's; Lift, the median of B's rate divided by A's, minus 1; and Lift low and Lift high, the 2.5% and 97.5% points of that same lift, so the true lift lies between them with 95% probability.

- **The model.** Each version's rate is a Beta(1 + conversions, 1 + visitors − conversions) belief: a flat prior updated by the counts, the standard Bayesian treatment of a conversion rate. A flat prior was chosen because it adds the least opinion and needs no setting; a prior control would be one more field most people can't fill in. A frequentist two-proportion test already exists as the Hypothesis Test node's Two-proportion z op, so this node answers the question people usually mean instead ("how likely is B better, and by how much"), which a p-value doesn't.
- **The method.** The node integrates rather than samples, so the answers are exact to the shown precision and identical on every pass. Each belief is tabulated on 4,001 points over its mean ± 12 standard deviations, with its CDF built by the trapezoid rule and normalized to end at 1. `P(B ≤ t·A)` is a Simpson sum over whichever belief is narrower at that `t`, reading the other's CDF from its table, so a sharp step in either is resolved at its own scale. B beats A is `1 − P(B ≤ A)`, and the lift points are found by bisecting `t` in log space. B beats A agrees with Evan Miller's closed form to 10⁻⁵ (the Rust tests check five cases), and the lift points agree with Monte Carlo draws within the draws' own noise.
- **Inputs and errors.** All four counts fall back to 0 when empty, which leaves that version at the flat prior. A negative count answers `#DOMAIN!`, and conversions above visitors answer `#VALUE!` naming the version; either error answers on all four outputs and clears the picture. A blank wired count blanks all four.
- **The picture** draws both beliefs over the span of both means ± 5 standard deviations: A neutral, B in the accent.

## Bootstrap

The Bootstrap node answers how far a statistic of a list could be from the population's: the statistic itself (Estimate, labelled with the op), and Low and High, the 2.5% and 97.5% points of the statistic over resamples of the values. The op is Mean, Median or Std dev (the sample standard deviation, divided by n − 1).

- **The method.** Each resample draws n values with replacement, and the interval is the percentile interval: the plain middle 95% of the resampled statistic, read by `PERCENTILE.INC` interpolation. The percentile interval was chosen over bias-corrected variants because it is the one a reader can check by eye against the histogram.
- **The seed.** The Seed input picks which shuffle the resamples come from. Left empty it shows `[from values]` and the seed is a fingerprint of the values themselves (FNV-1a over each number's bits, in order), so the same values give the same interval on every pass and every machine, and two Bootstrap nodes over different lists shuffle independently instead of in step, which a single shared seed would do and which would tie their errors together when two groups are compared. A typed whole number picks that shuffle, as R's `set.seed` does, and a Slider wired in scrubs through shuffles, which shows how much of Low and High is resampling noise. A seed that drew anew on each recalculation was rejected: the interval estimates one fixed quantity, so it moving with nothing changed would read as the data changing.
- **How many resamples.** 10,000, or fewer for a long list so a pass stays near 2 × 10⁷ draws, and never fewer than 1,000.
- **Inputs and errors.** Text and blanks in the list are skipped, as an aggregate skips them. An empty list blanks all three outputs. One value has no spread to resample and answers `#DIV/0!`.
- **The picture** is a histogram of the resampled statistic: columns inside Low to High in the accent, the rest neutral, and a dashed line at the Estimate. A statistic that only takes values on a regular grid, such as the mean of whole numbers, which moves in steps of 1/n, gets one column per step when that makes 60 columns or fewer, since 30 equal bins that don't line up with the steps would leave empty gaps. Any other statistic gets 30 equal bins.

## What would reopen this

A request for a prior on the A/B Test, for a confidence level other than 95%, or for a statistic beyond the three Bootstrap ops (a correlation, a percentile, a user's own LAMBDA) would each add a field, and each was left out to keep the cards readable by someone who doesn't know statistics.
