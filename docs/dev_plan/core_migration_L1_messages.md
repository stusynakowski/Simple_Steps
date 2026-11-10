# L1: the app's formula messages next to core's

> Run 2026-11-09 on core `fed4d1a`: each mistake the app's parser
> (`operation_formula.py`) refuses, through that parser and through core:
> `formula(text)`, then the step assigned in a kernel with a tool `dbl(n: int)`,
> steps `s` (n, city) and `t` (n), and a resource `db`. *formula():* means
> core refused while reading; *assign:* means it raised when the step was
> assigned; otherwise core's text is the step's problems. For
> [core_migration.md](core_migration.md) §3 L1, decision D3.

## A. The same, or nearly (12)

Core's wording replaces the app's with no loss.

| # | Input | App says | Core says |
|---|---|---|---|
| 2 | `dbl[mod.map()](wf["s"]` | Invalid expression: '(' was never closed | formula(): not a formula: '(' was never closed |
| 11 | `dbl[mod.map()](*wf["s"])` | *args and **kwargs aren't allowed in a formula | formula(): dbl[mod.map()](*wf['s']): a formula can't unpack arguments (* or **) |
| 24 | `dbl[mod.mapp()](wf["s"])` | unknown modifier mod.mapp; the modifiers are mod.auto, mod.breaker, mod.cast, mod.collapse, mod.copy, mod.distinct, mod.drop, mod.expand, mod.expect, mod.filter, mod.group, mod.map, mod.name, mod.pack, mod.rename, mod.retry, mod.select, mod.slice, mod.sort, mod.source, mod.sweep, mod.table, mod.timeout, mod.try_except, mod.widen | formula(): no modifier 'mapp'. Known: auto, breaker, cast, collapse, copy, distinct, drop, expand, expect, filter, group, map, name, pack, rename, retry, select, slice, sort, source, sweep, table, timeout, try_except, widen. Modifier kinds are declared in MODIFIERS; add one there. |
| 25 | `identity[mod.sort("n")](wf["s"])` | mod.sort(…) takes keyword settings, e.g. mod.sort(by="x") | formula(): mod.sort('n'): mod.sort() takes settings by keyword |
| 26 | `dbl[mod.map(over="s")](wf["s"])` | write the input once, in the call: tool[mod.map()](wf["…"]), not over= inside the brackets | formula(): mod.map(over='s'): over= is retired: give the input after the brackets, tool[mod.map(…)](wf["…"]) or mod.map(…)(wf["…"]) |
| 34 | `dbl[mod.retry(times="two"), mod.map()](wf["s"])` | retry's times= must be int, got str | retry's times= must be int, got str |
| 35 | `dbl[mod.map(nme="d")](wf["s"])` | map takes no parameter 'nme'; it accepts name | map takes no parameter 'nme'; it accepts name |
| 36 | `dbl[mod.map(), mod.filter()](wf["s"])` | 2 shape verbs in one step (map, filter); at most one is allowed. Split them into separate steps, the second reading the first with wf["…"] | 2 shape verbs in one step (filter, map); at most one is allowed. Split them into separate steps so every shape change keeps a cell address you can re-drive. |
| 42 | `wf["s"][0][1]` | wf["s"]: pick the rows once, e.g. wf["s"][0:2][cols["n"]] | formula(): this selection already has its rows; a selection has one row part and one cols[…] part |
| 44 | `wf["s"][0:4:2]` | wf["s"][a:b]: a range of rows takes no step | formula(): a row range can't have a step (start:stop only) |
| 45 | `wf["s"][0:"b"]` | wf["s"][a:b]: a range of rows is two numbers, either one left out | formula(): a row range takes int positions, got str |
| 46 | `wf["s"][rows[1.5]]` | rows[…] takes a row id or a list of them: rows["0.1"], rows[["A", "C"]] | formula(): rows are selected by row id, a list of row ids or a range of positions; got float |

## B. Core is better (5)

Core catches what the app's parser let through, or knows the data.

| # | Input | App says | Core says |
|---|---|---|---|
| 43 | `wf["s"][cols[3]]` | cols[…] takes a column name, a list of names or a range: cols["n"], cols[["a", "b"]], cols["a":"b"] | select: column 3 of 's', which has 2 columns (0–1) |
| 47 | `wf["s"]["a"]` | a plain bracket selects rows by int id; a text row id goes through rows: wf["s"][rows["a"]]. Columns use cols: wf["s"][cols["a"]] | select names 'a', which the input does not have (it has n, city) |
| 53 | `nope[mod.map()](wf["s"])` | accepted | 'nope' is not in this workflow's catalog |
| 54 | `dbl[mod.map()](wf["zzz"])` | accepted | input 'zzz', which is not an earlier step |
| 55 | `print(wf["s"])` | accepted | 'print' is not in this workflow's catalog |

## C. Core accepts, on purpose (3)

Core's decisions (a pick is a step; a pick can be an input; the verb is decided, S3).

| # | Input | App says | Core says |
|---|---|---|---|
| 8 | `wf["s"]` | wf["s"] on its own is a reference, not a step. To copy it, write identity[mod.slice()](wf["s"]) | accepted |
| 14 | `dbl[mod.retry(times=2)](wf["s"])` | the brackets need a shape verb (map, filter, select, …); retry and timeout only wrap one | accepted |
| 56 | `dbl[mod.map()](wf["s"][cols["n"]])` | a selection can't be a tool's input: make it its own step, whose formula is wf["s"][cols["n"]], and pass that step. As an argument it works: tool(wf["…"], n=wf["s"][cols["n"]]) | accepted |

## D. Core accepts, and probably shouldn't (4)

The app refused these; core takes them silently. Candidates for core asks.

| # | Input | App says | Core says |
|---|---|---|---|
| 6 | `res["db"].lookup[mod.map()]` | map reads a step: res["db"].lookup[mod.map()](wf["…"]) | accepted |
| 9 | `dbl[mod.map()]` | map reads a step: dbl[mod.map()](wf["…"]) | accepted |
| 15 | `dbl[mod.source()](wf["s"])` | source takes no input: dbl[mod.source()](…) | accepted |
| 40 | `identity[mod.sort(by=n)](wf["s"])` | mod.sort(by=n): text needs quotes, "n" | accepted |

## E. Core's wording is worse (25)

Right to refuse, but the app's message says more: what was meant and how to write it. Some leak core's internals (`binop`, `got Modifier`, `<Operation s>`).

| # | Input | App says | Core says |
|---|---|---|---|
| 1 | `res["db"] = DB(url="x")` | a step can use a resource but not create one. Create it from the Resources menu in the toolbar, or in the console: res["name"] = Type(setting=…) | formula(): not a formula: invalid syntax |
| 3 | `res["db"][mod.map()](wf["s"])` | res['db'] is not a tool name | formula(): res['db'] can't take […] in a formula |
| 4 | `wf["s"][mod.map()](wf["t"])` | wf['s'] is not a tool name | formula(): rows are selected by row id, a list of row ids or a range of positions; got Modifier |
| 5 | `os.system(wf["s"])` | os.system is not a tool | formula(): os.system: a formula reads only mod.<modifier>, res[…].<tool>, .isin and .idx |
| 10 | `1 + 2` | expected tool[mod.verb(…)](wf["…"], …) — a tool, its modifiers in brackets, and a call with the step it reads | formula(): 1 + 2: a binop isn't allowed in a formula |
| 12 | `dbl[mod.map()](wf["s"], wf["t"])` | a step reads one input; to combine steps use join(wf["a"], wf["b"], on=…), stack(wf["a"], wf["b"]) or zip_(wf["a"], wf["b"]) | formula(): dbl[mod.map()](wf['s'], wf['t']): dbl: pass these arguments by keyword — its parameters are not known here |
| 13 | `dbl[mod.map()](wf["s"], 3)` | after the input, only resources go by position (res["…"]); give 3 a name: dbl(…, name=3) | formula(): dbl[mod.map()](wf['s'], 3): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 16 | `join()` | join reads steps: join(wf["a"], wf["b"], …) | formula(): join(): join() missing 2 required positional arguments: 'left' and 'right' |
| 18 | `join(wf["s"], "n")` | join combines steps; each positional argument is wf["…"], not 'n'. Settings go by keyword, e.g. on="city" | join needs on= — the key column(s) to merge on; input 2 'n', which is not an earlier step |
| 22 | `join(wf["s"], wf["t"], on=str(1))` | join(on=…) must be a literal, not str(1) | formula(): str(1): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 23 | `dbl[map()](wf["s"])` | map() isn't a modifier; write mod.map(…), mod.select(…), mod.retry(…), … | formula(): map(): map: pass the data to apply it to, or a step reference to wire it |
| 27 | `dbl[mod.map()](dbl[mod.map()](wf["s"]))` | an operation can't be an input yet (core's P0); make it its own step and pass wf["…"] | formula(): dbl[mod.map()](dbl[mod.map()](wf['s'])): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 28 | `dbl[mod.map()](s)` | s is not defined. To use the step "s", write wf["s"] | formula(): dbl[mod.map()](s): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 29 | `dbl[mod.map()]("s")` | the input must be a step reference; "s" is a string. Did you mean wf["s"]? | formula(): dbl[mod.map()]('s'): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 30 | `dbl[mod.map()](3)` | the input must be a step reference, wf["…"], not 3 | formula(): dbl[mod.map()](3): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 31 | `dbl[mod.map()](wf["s"], n=str(1))` | n: an operation can't be an argument; make it its own step and pass wf["…"] | formula(): str(1): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 32 | `dbl[mod.map()](wf["s"], n=x)` | n=x: x is not defined. A step is wf["x"]; text is "x" | n: an Operation isn't a literal; a function belongs in a setting that takes a tool, as a registered @tool, or make it a step |
| 33 | `dbl[mod.map()](wf["s"], n=1+x)` | n must be a literal (text, a number, a list, …) or wf["…"], not 1 + x | formula(): 1 + x: a binop isn't allowed in a formula |
| 37 | `dbl[mod.sort(by="n")](wf["s"])` | sort applies no tool, so it runs on identity: identity[mod.sort(by='n')](wf["…"]). To compute with dbl, use map: dbl[mod.map()](wf["…"]) | sort applies no tool; use map to compute |
| 39 | `identity[mod.sort(by=wf["s"])](wf["s"])` | mod.sort(by=…) is a setting, and settings are literals. A step reference goes in the call | sort's by= reads 's', which holds DataFrame; it must be str or list or tuple |
| 41 | `identity[mod.sort(by=str(1))](wf["s"])` | mod.sort(by=…) must be a literal, not str(1) | formula(): str(1): a tool's input in a formula is a step or a pick, wf["…"]; values go in as name=value |
| 48 | `wf["s"][1.5]` | wf["s"][…] takes rows ([1], [[0, 2]], [1:3], rows["0.1"]) or columns (cols["n"]) | formula(): rows are selected by row id, a list of row ids or a range of positions; got float |
| 49 | `dbl[mod.map()](wf[s])` | wf[…] takes a step name in quotes: wf["readings"] | formula(): 'a step reference takes a step id (a string), got <Operation s>' |
| 50 | `dbl[mod.map()](wf["s"], db=res[db])` | res[…] takes a resource name in quotes: res["db"] | formula(): 'a resource name must be an identifier, got <Operation db>' |
| 51 | `wf[mod.map()](wf["s"])` | wf[…] takes a step name in quotes: wf["readings"] | formula(): 'a step reference takes a step id (a string), got map()' |

## F. Core's error looks like a bug (5)

Raw Python errors, or no text at all.

| # | Input | App says | Core says |
|---|---|---|---|
| 7 | `res["db"]` | res["db"] on its own is a resource, not a step. Use one of its tools, res["db"].<tool>(…), or pass it to a tool: tool[mod.map()](wf["…"], res["db"]) | assign: res['db'].data_version has no instance until the workflow runs. Wire it into a step: wf[...] = res['db'].data_version[mod.map()](wf[...]). |
| 19 | `join(wf["s"], wf["t"], on=res["db"])` | join applies no tool, so it takes no resource | assign: 'ResRef' object is not iterable |
| 20 | `join(wf["s"], wf["t"], on=wf["s"])` | join(on=…) is a setting, and settings are literals. The steps it combines go first, as positional wf["…"] | assign:  |
| 21 | `join(wf["s"], wf["t"], on=n)` | join(on=n): text needs quotes, "n" | assign: a bracket layer must be a Modifier — mod.map(), mod.retry(times=...); got int. Modifiers are data; a plain decorator would not serialize. |
| 38 | `identity[mod.sort(by=res["db"])](wf["s"])` | mod.sort(by=…) is a setting, and settings are literals. A resource goes in the call: tool[…](wf["…"], name=res["…"]) | assign: 'ResRef' object is not iterable |

## Both accept (2)

| # | Input | App says | Core says |
|---|---|---|---|
| 17 | `join(wf["s"], wf["t"], on="n", how="sideways")` | accepted | accepted |
| 52 | `(dbl)[mod.map()](wf["s"])` | accepted | accepted |
