# Excel Parity Fixture Schema

These fixtures are synthetic parity scaffolds unless `fixture_kind` says otherwise. They are not evidence of parity with an external institutional Excel model.

`representative-maple-heights-excel-v1.json` is generated from the representative workbook used to build the parity harness. It is a formula-driven validation package, not an external institutional parity source.

Each JSON fixture contains:

- `fixture_kind`: `synthetic_excel_parity_scaffold` or `representative_excel_validation_package`.
- `project_deal_name`: deal label shown in variance output.
- `source_model_version`: model or workbook version that produced expected values.
- `input_key`: engine input preset used by synthetic scaffold tests.
- `scenario`: scenario name, currently `base`.
- `expected_outputs`: metric rows with `metric_key`, `expected_value`, `tolerance`, or `tolerance_abs` and `tolerance_pct`.
- `source_cell`: workbook cell reference for generated representative rows.
- `workbook_checks`: captured check rows from the source workbook.

Variance output reports project or deal name, scenario, metric key, expected value, actual value, absolute variance, percentage variance, tolerance, source model version, and source cell.
