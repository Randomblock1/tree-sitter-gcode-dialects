; Comments
[
  (semicolon_comment)
  (hash_comment)
  (klipper_inline_comment)
  (parenthesized_comment)
  (jinja_comment_inline)
] @comment

; Commands and control words
(g_code) @function.builtin
(m_code) @function.builtin
(tool_code) @type.builtin
(extended_command) @function
(o_label) @label
(o_keyword) @keyword

[
  (rrf_declaration_keyword)
  (rrf_set_keyword)
  (rrf_control_keyword)
  (rrf_else_keyword)
  (rrf_loop_control_keyword)
  (rrf_output_keyword)
] @keyword

(jinja_directive) @keyword

; Klipper configuration
(section_start) @tag
(section_name) @type
(option_name) @property
(klipper_option_text) @string

; G-code operands
(line_number) @comment.doc
(checksum) @comment.doc
(axis_word) @variable.special
(feed_word) @number
(spindle_word) @number
(parameter_word) @number
(expression_word) @variable.special
(argument_name) @property
(parameter_reference) @variable.special
(spaced_parameter_reference) @variable.special
(indirect_parameter_reference) @variable.special
(system_variable) @variable.special
(quoted_word) @string

; Expressions
(number) @number
[
  (double_quoted_string)
  (single_quoted_string)
] @string
(boolean) @boolean
(null) @constant.builtin

(rrf_declaration name: (identifier) @variable)
(reference_expression object: (identifier) @variable)
(member_access property: (identifier) @property)
(call_expression function: (identifier) @function)
(call_expression function: (reference_expression) @function)
(filter_expression filter: (identifier) @function)

; The grammar tags every expression operator with an `operator` field, so one
; field pattern per expression kind replaces enumerating the literals.
(binary_expression operator: _ @operator)
(unary_expression operator: _ @operator)
(multiline_string_expression operator: _ @operator)
(jinja_directive "in" @operator)
(percent_line "%" @operator)

[
  "="
  "?"
  "|"
] @operator

[
  ","
  (comma)
  ":"
  (colon)
] @punctuation.delimiter

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "{%"
  "{%-"
  "%}"
  "-%}"
] @punctuation.bracket
