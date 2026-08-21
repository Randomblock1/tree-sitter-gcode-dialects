(klipper_section
  kind: (section_start) @context
  name: (section_name) @name) @item

(rrf_declaration
  keyword: (rrf_declaration_keyword) @context
  name: (identifier) @name) @item

((o_statement
  label: (o_label) @name
  keyword: (o_keyword) @context) @item
  (#match? @context "^[sS][uU][bB]$"))
