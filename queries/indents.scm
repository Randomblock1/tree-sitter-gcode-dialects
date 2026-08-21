; Zed only honors an @indent capture whose node spans past the target row's
; first non-whitespace column; every statement node in this grammar ends at
; column 0 of the next row, so statement-level @indent is inert (and worse,
; trips Zed's outdent branch, cancelling increase_indent_pattern). Block
; indentation therefore lives in each language's config.toml. At least one
; @indent must remain or Zed discards this whole query, @start.* included.

(brace_expression "}" @end) @indent
(bracket_expression "]" @end) @indent
(argument_list ")" @end) @indent

; @start.<suffix> anchors feed the `valid_after` lists in config.toml's
; decrease_indent_patterns.
((rrf_control keyword: (rrf_control_keyword) @_kw) @start.if
  (#eq? @_kw "if"))
((rrf_control keyword: (rrf_control_keyword) @_kw) @start.elif
  (#eq? @_kw "elif"))
((rrf_control keyword: (rrf_control_keyword) @_kw) @start.while
  (#eq? @_kw "while"))
(rrf_else) @start.else

((jinja_statement_inline directive: (jinja_directive) @_d) @start.jinja_if
  (#match? @_d "^if\\b"))
((jinja_statement_inline directive: (jinja_directive) @_d) @start.jinja_elif
  (#match? @_d "^elif\\b"))
((jinja_statement_inline directive: (jinja_directive) @_d) @start.jinja_for
  (#match? @_d "^for\\b"))
