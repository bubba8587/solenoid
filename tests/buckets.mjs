// [[D99]] rustIsSpec
// Every test file in one domain, and every domain in one tier, so a change can run the tests around it
// (`node scripts/test-bucket.mjs <tier|domain>`) and a failure says at once which layer broke. The first rule whose
// pattern matches a file's path wins; `tests/graph/testBuckets.test.ts` fails a file no rule claims.

/** How much stands on a domain: core is what every card and document runs on, surface is what a person sees and
 *  touches, nodes is the card set itself, meta keeps the repository honest. */
export const TIERS = {
  core: ["engine", "values", "formulas", "frames", "documents"],
  surface: ["canvas", "ui", "figures", "integrations"],
  nodes: ["nodes"],
  meta: ["meta"],
};

/** Ordered: the first match wins, so a narrow rule sits above a broad one. Patterns match the path from the repo root. */
export const RULES = [
  // ── meta: the repository's own rules, docs, site and build ──
  ["meta", /(^|\/)(rules|docsPointers|sourceInvariants|sourceHygiene|specDiagrams|uiCopy|wasmStamp|rustTestPaths|settingsAudit|socketReference|functionReferenceLibs|siteMeta|siteThumbs|landingBuildQueue|landingCompute|androidPrep|androidShell|desktopCsp|cssSyntax|cssTokens|finePrintContract|helpSection|docMeta|surfaceReviewPins|reviewPins|auditFixes|testBuckets|chunkReloadGuard|imageAssets|externalLinks)\.test\./],
  ["meta", /^tests\/graph\/landing\//],
  ["meta", /^scripts\//],

  // ── nodes: the card set and the packs ──
  ["nodes", /^tests\/graph\/(nodes|packs)\//],
  ["nodes", /(^|\/)(cardSweep|nodeFuzz|nodeOps|nodeNames|nodeNameStore|cardTitle|cardLayout|decisionIntuition|decisionMatrix|monteCarlo|tornadoRun|qrCode|weightedShuffle|regexCard|timeZoneCards|cardsRefuseText|cardBlankReads|cardFormulaTwins|coreCardHelpers|coreCardShapes|coreNodes|directBodies|catalogRegistry|nodeStoreRegistry|textFormCatalog|literalEditors|inputRoles|controlledCell|constrainedEntry|listInputChip|nameCase|equationUnits|financeUnits|trigMode|uncertainValue|dataProviders|coreProviders|fxConvert|fxProvider|geocodeProvider|holidaysProvider|weatherProvider|coreQr|cardBatchBench)\.test\./],

  // ── figures: charts, the Gantt and the scheduler, records ──
  ["figures", /^packages\/gantt-layout\//],
  ["figures", /(^|\/)(chart\w*|heatmap|sparklineFormula|gantt\w*|scheduleCpm|recordViews|recordNav|recordCardsFromPopup|displayPeekCoverage|displayPopupCoverage|fcLambdaChart|reportExport|svgLayer|rasterAtlas|vectorOrient|valueDisplayAnnotation|chipStyle|categoryColor|palette|cssColor)\.test\./],

  // ── integrations: Obsidian, files, the network, scripts, AI ──
  ["integrations", /^tests\/obsidian-plugin\//],
  ["integrations", /(^|\/)(obsidian\w*|note\w*|knap\w*|vault\w*|taskNotes\w*|demoVault|frontmatterPatch|importNoteRepick|importObsidianGone|localFileRace|filePickerModel|chooseFile|httpBridge|ipcBridge|script\w*|ai\w*|apiKeyStore|mailMergeSeed|planImport|pluginColumnTypes|managedBlock|csvSafety|svgSanitize|polyformIntegration)\.test\./],

  // ── documents: saves, the text form, seeds, the workspace ──
  ["documents", /(^|\/)(persistence\w*|textForm\w*|coreTextForm|seeds\w*|\w+Seed|seedsCompute|pfSeedCheck|document\w*|saveTimeStore|fileSession|historyDigest|copyPasteSnapshot|foreignPaste|recentDocs|workspace\w*|relocationKeepsStores|filterPersistence|activeGraph|graphStub|sketchExport|textDiff|draftFlush)\.test\./],

  // ── named exceptions, above the broad rules below that would claim them by prefix ──
  ["ui", /(^|\/)(tableEdit|tableSortFilter|tablePopupSuggest)\.test\./],
  ["canvas", /(^|\/)(baseView|domSync|renderMode|liveCardUnmounted|isolate\w*|drillStackGate|cablePendingReconnect|deleteSelectionScope|presentSocketStore|socketFlip|fcDockReload|pushWorldDockedFc|tidyDisplayFcWidth|fcChainDelete)\.test\./],

  // ── frames: tables, cubes and their verbs ──
  ["frames", /(^|\/)(frame\w*|cube\w*|pivot\w*|csv|coreCsv|coreInferColumn|corePlanReaders|reconcile|joinUnits|computedColumn\w*|table\w*|columnSort|columnPicker|describeProfile|backendVerbCards|lazyVerbBodies|lazyFrameReads|lazyChain|cellErrorScan|listSortOrder|listPreview|tableFooterStats|frameHint|indexPosition|conduitFilterTypes)\.test\./],

  // ── formulas: the formula language and its functions ──
  ["formulas", /(^|\/)(excel\w*|formula\w*|blankArgIsExcelBlank|broadcast\w*|generatorCaps|spreadLimit|distributionFormula|criteriaFamily|nodeFormulaArgParity|rangeLift|rangeRouting|rangeCallMemo|expressionMatrix|emptySlots|datetimeParity|timeZone|fuzzy|coreConformance|corePlatform|coreSurrogates|coreParseDate|coreLimits|caseContract|stringOrder|roundingParity|scientificCutoff|complexInvariants|dispatchThrow)\.test\./],

  // ── values: errors, dates, units, formats ──
  ["values", /(^|\/)(error\w*|date\w*|datesNeverSerials|volatileDates|unit\w*|coreUnitCatalog|convertUnitLabels|cubeColumnUnits|valueKinds|formatModel|format\w*|fc\w*|coreFcReconcile|coreFcTag|noTextGuessing|noteFcPropagation|heldValues|coreAnnotations|coreDimLabels|pushWorldDockedFc|compositeFcSettle|tidyDisplayFcWidth)\.test\./],

  // ── engine: the graph model, the pass, sockets and types ──
  ["engine", /(^|\/)(graph\w*|dataflowEngine|process\w*|core\w*|dimension|settle|socket\w*|passthrough\w*|trueAnyAdopt|typesKnownAfterCalc|namedEdits|cardWireBinary|binaryBytes|perfScaling|passBench|wasmEngineBench|circularReset|clampSeeding|connectionRace|connectionStore|calcModeStore|composite\w*|closedCompositePrune|drillStackGate|isolate\w*|coerceInputs|baseView|domSync|liveCardUnmounted|renderMode|cablePendingReconnect|cableSettlePipe|cableValueStore|presentSocketStore|deleteSelectionScope|fcChainDelete)\.test\./],

  // ── canvas: layout, cables, gestures, the React Flow view ──
  ["canvas", /^tests\/graph\/(flow|components)\//],
  ["canvas", /(^|\/)(cable\w*|canvas\w*|group\w*|tidy\w*|layout\w*|standoff\w*|collapseStore|conduit\w*|hic\w*|zoomSettle|touch\w*|pointerGesture|drawnCablePath|pathPoints|selectionOps|lockedContextMenus|landscapePhoneScale|viewPresets|nodeSizeStore|flowPreview|gridKeyboard|modalGuard|fireMenuKey|selectChevron)\.test\./],

  // ── ui: stores, menus, search, popups, settings ──
  ["ui", /(^|\/)(\w+Store|catalogSearch|searchSamples|nameSurfaces|tablePopupSuggest|tableEdit|tableSortFilter|helpSection|commentStore|problemsStore|pinStore|inspectorStore|settingsStore)\.test\./],
];

/** The domain a test file belongs to, or `undefined` when no rule claims it. */
export function domainOf(file) {
  const rel = file.replace(/\\/g, "/");
  for (const [domain, re] of RULES) if (re.test(rel)) return domain;
  return undefined;
}

/** The tier holding a domain. */
export function tierOf(domain) {
  return Object.keys(TIERS).find((t) => TIERS[t].includes(domain));
}
