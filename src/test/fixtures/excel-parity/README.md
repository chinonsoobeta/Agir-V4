# Excel Parity Fixture Schema

These fixtures are synthetic parity scaffolds unless `fixture_kind` says otherwise. They are not evidence of parity with an external institutional Excel model.

Each JSON fixture contains:

- `fixture_kind`: currently `synthetic_excel_parity_scaffold`.
- `project_deal_name`: deal label shown in variance output.
- `source_model_version`: model or workbook version that produced expected values.
- `input_key`: engine input preset used by the test.
- `scenario`: scenario name, currently `base`.
- `expected_outputs`: metric rows with `metric_key`, `expected_value`, and absolute `tolerance`.

Variance output reports project or deal name, scenario, metric key, expected value, actual value, absolute variance, percentage variance, tolerance, and source model version.
