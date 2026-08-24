/*
 * An independently authored, deliberately tolerant grammar for the G-code
 * people edit in practice. Firmware validates commands and parameter types;
 * this grammar preserves useful structure even for unknown vendor commands.
 */

const PREC = {
  CONDITIONAL: 1,
  OR: 2,
  AND: 3,
  COMPARE: 4,
  CONCAT: 5,
  ADD: 6,
  MULTIPLY: 7,
  POWER: 8,
  UNARY: 9,
  POSTFIX: 10,
};

// No scientific exponent: E is the extruder axis, so X10E5 must lex as two
// words (X10, E5), and LinuxCNC rejects exponents in words outright.
const DECIMAL = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const CODE_NUMBER = String.raw`[-+]?\d+(?:\.\d+)?`;
const NL_RUN = String.raw`(?:\r?\n[ \t]*)+`;

module.exports = grammar({
  name: "gcode",

  extras: ($) => [/[ \t\f]/],

  word: ($) => $.identifier,

  supertypes: ($) => [$._expression, $._program_item],

  conflicts: ($) => [
    [$._expression, $.multiline_string_expression],
    // Newline runs between a tuple's elements and its close parenthesis.
    [$.tuple_expression],
  ],

  rules: {
    source_file: ($) =>
      repeat(
        choice(
          $._newline,
          $.semicolon_comment,
          $.hash_comment,
          $.percent_line,
          $.klipper_section,
          $.klipper_option,
          $.klipper_glyph_line,
          $.rrf_declaration,
          $.rrf_assignment,
          $.rrf_control,
          $.rrf_else,
          $.rrf_loop_control,
          $.rrf_output,
          $.o_statement,
          $.program_line,
          $.star_line,
        ),
      ),

    // Decorative separator lines ("* * * * *") in shop-floor Fanuc output.
    star_line: ($) => seq(token(prec(-2, /\*[ \t*]*/)), $._newline),

    _newline: (_) => /\r?\n/,

    semicolon_comment: (_) => /;[^\r\n]*/,
    // "##" followed by a digit stays parameter indirection (Fanuc ##2);
    // any other "##"-run is a comment.
    //
    // "#[" is the contested one: it opens LinuxCNC indirection ("#[#1] = 0")
    // and it opens a commented-out Klipper section ("#[tmc2208 stepper_x]").
    // The first character that could start an expression decides — a digit,
    // "#", a sign, or a decimal point means indirection, anything else means
    // prose. Nesting and spaces are skipped first, so "#[[#1+1]*2]" is still
    // indirection and "#[[tmc2130 stepper_x]" is still a comment. Both
    // branches lex at the same precedence, so the comment wins by being the
    // longer match wherever it applies at all.
    hash_comment: (_) =>
      choice(
        "#",
        /#{3,}[^\r\n]*/,
        /##(?:[^0-9\r\n][^\r\n]*)?/,
        /#[^0-9<#\[\r\n][^\r\n]*/,
        /#\[[ \t\[]*[^0-9#\[+\-. \t\r\n][^\r\n]*/,
      ),
    // One level of nesting: real Fanuc output contains "(A (B))" comments.
    // The unterminated variant (prec -4) tolerates prose like "(The height is
    // used only" in doc text; a real ")" on the line always wins.
    parenthesized_comment: (_) =>
      choice(
        token(prec(-1, /\((?:[^()\r\n]|\([^()\r\n]*\))*\)/)),
        token(prec(-4, /\([^()\r\n]*/)),
      ),

    percent_line: ($) =>
      prec.right(seq("%", optional($.semicolon_comment), $._newline)),

    // The optional trailing text tolerates usage-docstring continuation lines
    // inside multiline option values ("[MINIMUM=<min>] [SPEED=<speed>]") —
    // a flat line grammar cannot know they are still part of the value.
    klipper_section: ($) =>
      prec.right(
        5,
        seq(
          field("kind", $.section_start),
          optional(field("name", $.section_name)),
          optional("]"),
          optional($.klipper_option_text),
          optional($.hash_comment),
          $._newline,
        ),
      ),
    section_start: (_) => /\[[A-Za-z_][A-Za-z0-9_-]*/,
    section_name: (_) =>
      /[A-Za-z0-9_.~*<>=|,+\/-]+(?:[ \t]+[A-Za-z0-9_.~*<>=|,+\/-]+)*/,

    klipper_option: ($) =>
      prec.right(
        3,
        seq(
          field("name", $.option_name),
          choice(
            repeat1(
              choice(
                $._template_item,
                $.bracket_expression,
                $.named_argument,
                $.bare_argument,
                $.string,
                $.number,
                $.comma,
                $.colon,
              ),
            ),
            optional($.klipper_option_text),
          ),
          optional($.klipper_inline_comment),
          $._newline,
        ),
      ),
    // The "=" branch requires a second letter/underscore in the name so that
    // Siemens address assignments at line start (S1=5000, R10=R11+2) stay
    // program lines instead of lexing as a Klipper option.
    option_name: (_) =>
      token(
        prec(
          10,
          /(?:[A-Za-z_][A-Za-z0-9_]*:|[A-Za-z_][0-9]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=)/,
        ),
      ),
    klipper_option_text: (_) => token(prec(-1, /[^#\r\n]+/)),
    klipper_inline_comment: (_) => /#[^\r\n]*/,
    // Comments on elements of multiline list/dict values. The mandatory blank
    // after "#" keeps RRF's length operator (#param.S) and LinuxCNC's
    // indirection (#[expr]) out of comment territory.
    list_comment: (_) => token(/#[ \t][^\r\n]*/),
    klipper_glyph_line: ($) => seq($.glyph_pixels, $._newline),
    // Minimum 5: hd44780 glyph rows are 5 wide, ST7920 rows 16 — while a
    // shorter dot run at line start ("... loading") is prose, not pixels.
    glyph_pixels: (_) => /[.*]{5}[.*]*/,

    rrf_declaration: ($) =>
      rrfLine(
        $,
        $.rrf_declaration_keyword,
        field("name", $.identifier),
        "=",
        field("value", $._expression),
      ),

    rrf_assignment: ($) =>
      rrfLine(
        $,
        $.rrf_set_keyword,
        field("target", $._assignable),
        "=",
        field("value", $._expression),
      ),

    rrf_control: ($) =>
      rrfLine($, $.rrf_control_keyword, field("condition", $._expression)),

    rrf_else: ($) => rrfLine($, $.rrf_else_keyword),

    rrf_loop_control: ($) => rrfLine($, $.rrf_loop_control_keyword),

    rrf_output: ($) =>
      rrfLine(
        $,
        $.rrf_output_keyword,
        repeat(choice($._expression, $.bare_argument, $.comma)),
      ),

    rrf_declaration_keyword: (_) => choice("var", "global"),
    rrf_set_keyword: (_) => "set",
    rrf_control_keyword: (_) => choice("if", "elif", "while"),
    rrf_else_keyword: (_) => "else",
    rrf_loop_control_keyword: (_) => choice("break", "continue"),
    rrf_output_keyword: (_) => choice("echo", "abort"),

    o_statement: ($) =>
      prec.right(
        seq(
          field("label", $.o_label),
          optional(field("keyword", $.o_keyword)),
          repeat(
            choice(
              $.bracket_expression,
              $.parameter_reference,
              $.number,
              $.bare_argument,
              $.parenthesized_comment,
            ),
          ),
          optional(choice($.semicolon_comment, $.hash_comment)),
          $._newline,
        ),
      ),
    o_label: (_) => token(prec(9, /[oO](?:\d+(?:\.\d+)?|<[^>\r\n]+>)/)),
    o_keyword: (_) =>
      token(
        caseInsensitiveWords([
          "endrepeat",
          "endwhile",
          "continue",
          "elseif",
          "endsub",
          "return",
          "repeat",
          "endif",
          "break",
          "while",
          "call",
          "else",
          "sub",
          "if",
          "do",
        ]),
      ),

    program_line: ($) =>
      prec.right(
        seq(
          optional($.block_delete),
          choice(
            // A bare block number (with or without a trailing comment) is a
            // complete line — Siemens and Fanuc output is full of them.
            seq($.line_number, optional($._line_body)),
            $._line_body,
          ),
          optional($.checksum),
          optional(choice($.semicolon_comment, $.hash_comment)),
          $._newline,
        ),
      ),
    _line_body: ($) =>
      prec.right(
        choice(
          seq(field("command", $._command), repeat($._program_item)),
          repeat1($._program_item),
        ),
      ),

    block_delete: (_) => "/",
    line_number: (_) => token(prec(8, /[Nn]\d+(?:\.\d+)?/)),
    checksum: (_) => /\*\d+/,

    _command: ($) =>
      choice($.g_code, $.m_code, $.tool_code, $.extended_command),
    g_code: (_) => codeWord("Gg"),
    m_code: (_) => codeWord("Mm"),
    tool_code: (_) => codeWord("Tt"),
    // A digit run may not be followed directly by a letter: that boundary is
    // where compact G-code splits (G1X10 is G1 + X10, SET_TMC2209_FIELD is
    // one command). Equal-length matches then let the prec-8 code words win.
    extended_command: (_) =>
      token(prec(-1, /[A-Za-z_](?:[A-Za-z_]|\d+_)*(?:[A-Za-z_]|\d+)/)),

    _program_item: ($) =>
      choice(
        $.address_assignment,
        $.axis_word,
        $.feed_word,
        $.spindle_word,
        $.parameter_word,
        $.expression_word,
        $.named_argument,
        $.parameter_assignment,
        $.parameter_reference,
        $.indirect_parameter_reference,
        $.spaced_parameter_reference,
        $.brace_expression,
        $.bracket_expression,
        $.jinja_statement_inline,
        $.jinja_comment_inline,
        $.parenthesized_comment,
        $.quoted_word,
        $.string,
        $.number,
        $.colon,
        $.comma,
        $.loose_assignment,
        $.bare_argument,
      ),

    // Siemens/Fanuc assignment with the "=" detached from its target:
    // "R1 = LAYER_HEIGHT * 4", "ACC[E]=50", "DEF REAL A = 2, B = 9". The
    // target is whatever program item came before; only "=" and the value
    // are grouped.
    loose_assignment: ($) =>
      prec.right(seq("=", optional(field("value", $._expression)))),

    // Siemens-style address assignment: X1=50, S1=5000, R10=R11+2. The "="
    // must be immediate — the axis/parameter token has already won the lexer
    // race by the time it appears, so the pairing happens at parse level.
    address_assignment: ($) =>
      seq(
        field("address", choice($.axis_word, $.spindle_word, $.parameter_word)),
        token.immediate("="),
        field("value", choice($._expression, $.bare_argument)),
      ),

    axis_word: (_) => letterWord("XYZABCUVWExyzabcuvwe", 7),
    feed_word: (_) => letterWord("Ff", 7),
    spindle_word: (_) => letterWord("Ss", 7),
    parameter_word: (_) => letterWord("A-Za-z", 6),
    expression_word: ($) =>
      choice(
        seq(
          field("prefix", $.brace_word_start),
          optional(commaSep1($._expression)),
          "}",
        ),
        seq(
          field("prefix", $.bracket_word_start),
          optional(commaSep1($._expression)),
          "]",
        ),
        seq(
          field("prefix", $.parameter_bracket_word_start),
          $._expression,
          "]",
        ),
        $.parameter_reference_word,
      ),
    brace_word_start: (_) => /[A-Za-z]\{/,
    bracket_word_start: (_) => /[A-Za-z]\[/,
    parameter_bracket_word_start: (_) => /[A-Za-z]#\[/,
    parameter_reference_word: (_) => /[A-Za-z]#+(?:\d+|<[^>\r\n]+>)/,
    quoted_word: (_) =>
      choice(/[A-Za-z]"(?:[^"\\\r\n]|\\.)*"/, /[A-Za-z]'(?:[^'\\\r\n]|\\.)*'/),

    named_argument: ($) =>
      prec.right(
        seq(
          field("name", $.argument_name),
          optional(field("value", choice($._expression, $.bare_argument))),
        ),
      ),
    argument_name: (_) => /[A-Za-z_][A-Za-z0-9_]*=/,
    parameter_assignment: ($) =>
      prec(
        1,
        seq(
          field(
            "target",
            choice($.parameter_reference, $.indirect_parameter_reference),
          ),
          "=",
          field("value", $._expression),
        ),
      ),

    jinja_statement_inline: ($) =>
      seq(
        choice("{%", "{%-"),
        field("directive", $.jinja_directive),
        // prec(2) so "-%}" outranks the prec-1 "-" operator after an
        // expression — "defined -%}" must close the statement, not subtract.
        choice("%}", token(prec(2, "-%}"))),
      ),
    jinja_directive: ($) =>
      choice(
        seq(
          "set",
          commaSep1($._assignable),
          "=",
          repeat($._newline),
          commaSep1($._expression),
        ),
        seq(choice("if", "elif"), $._expression),
        "else",
        "endif",
        seq(
          "for",
          commaSep1($.identifier),
          "in",
          $._expression,
          optional(seq("if", $._expression)),
          optional("recursive"),
        ),
        "endfor",
        seq("macro", $.identifier, optional($.argument_list)),
        "endmacro",
        seq(
          choice(
            "filter",
            "with",
            "block",
            "extends",
            "include",
            "import",
            "from",
            "do",
          ),
          repeat($._template_item),
        ),
        "endfilter",
        "endwith",
        "endblock",
        "raw",
        "endraw",
        "break",
        "continue",
      ),
    jinja_comment_inline: (_) =>
      token(
        seq("{#", repeat(choice(/[^#\r\n]/, /#[^}\r\n]/)), optional("#"), "#}"),
      ),
    _template_item: ($) =>
      choice(
        $.brace_expression,
        $.jinja_statement_inline,
        $.jinja_comment_inline,
      ),

    _assignable: ($) =>
      choice($.identifier, $.parameter_reference, $.reference_expression),

    _expression: ($) =>
      choice(
        $.number,
        $.string,
        $.boolean,
        $.null,
        $.parameter_reference,
        $.indirect_parameter_reference,
        $.spaced_parameter_reference,
        $.identifier,
        $.reference_expression,
        $.call_expression,
        $.brace_expression,
        $.bracket_expression,
        $.parenthesized_expression,
        $.tuple_expression,
        $.unary_expression,
        $.binary_expression,
        $.conditional_expression,
        $.filter_expression,
      ),

    // Trailing commas are load-bearing for RRF: "{pi,}" is a one-element
    // array while "{pi}" is a scalar.
    brace_expression: ($) =>
      delimitedList($, "{", "}", choice($._expression, $.dict_entry), {
        trailingComma: true,
      }),
    bracket_expression: ($) =>
      delimitedList($, "[", "]", $._expression, { trailingComma: true }),
    dict_entry: ($) =>
      seq(
        field("key", $._expression),
        ":",
        repeat($._newline),
        field("value", choice($.multiline_string_expression, $._expression)),
      ),
    parenthesized_expression: ($) =>
      seq("(", repeat($._newline), $._expression, repeat($._newline), ")"),
    tuple_expression: ($) =>
      seq(
        "(",
        repeat($._newline),
        $._expression,
        ",",
        repeat($._newline),
        optional(
          seq(
            commaSepWithNewlines1($._expression, $),
            optional(","),
            repeat($._newline),
          ),
        ),
        ")",
      ),

    reference_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(
          field(
            "object",
            choice($.identifier, $.string, $.parenthesized_expression),
          ),
          repeat1(choice($.member_access, $.subscript_access)),
        ),
      ),
    member_access: ($) => seq(".", field("property", $.identifier)),
    subscript_access: ($) =>
      seq(
        "[",
        optional(field("index", choice($._expression, $.slice_expression))),
        "]",
      ),
    slice_expression: ($) =>
      seq(
        optional($._expression),
        ":",
        optional($._expression),
        optional(seq(":", optional($._expression))),
      ),
    call_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(
          field("function", choice($.identifier, $.reference_expression)),
          field("arguments", $.argument_list),
          repeat(choice($.member_access, $.subscript_access, $.argument_list)),
        ),
      ),
    argument_list: ($) =>
      delimitedList(
        $,
        "(",
        ")",
        choice(
          $.multiline_string_expression,
          $._expression,
          $.keyword_argument,
        ),
        { trailingComma: true },
      ),
    keyword_argument: ($) =>
      prec(PREC.COMPARE + 2, seq($.identifier, "=", $._expression)),
    multiline_string_expression: ($) =>
      prec.right(
        seq(
          $.string,
          repeat1($._newline),
          choice(
            $.multiline_string_expression,
            seq(
              $.string,
              optional(
                seq(field("operator", "%"), field("right", $._expression)),
              ),
            ),
          ),
        ),
      ),

    unary_expression: ($) =>
      prec(
        PREC.UNARY,
        seq(
          field("operator", choice("!", "-", "+", $.not_operator, "#")),
          field("operand", $._expression),
        ),
      ),

    binary_expression: ($) =>
      choice(
        ...binaryLeft(
          PREC.OR,
          [
            caseInsensitiveWords(["or"]),
            "||",
            continuationWordOp("or"),
            continuationOp("||"),
          ],
          $,
        ),
        ...binaryLeft(
          PREC.AND,
          [
            caseInsensitiveWords(["and", "xor"]),
            "&&",
            continuationWordOp("and"),
            continuationOp("&&"),
          ],
          $,
        ),
        ...binaryLeft(
          PREC.COMPARE,
          [
            "==",
            "=",
            "!=",
            "<>",
            "<=",
            ">=",
            "<",
            ">",
            caseInsensitiveWords(["in", "is"]),
          ],
          $,
        ),
        ...binaryLeft(PREC.COMPARE, [$.text_comparison_operator], $),
        ...binaryLeft(
          PREC.COMPARE + 1,
          [$.not_in_operator, $.is_not_operator, $.is_in_operator],
          $,
        ),
        ...binaryLeft(PREC.CONCAT, ["^", "~", continuationOp("~")], $),
        // token(prec(1)) so that mid-expression the lexer picks the shorter
        // operator over a longer signed number ("100-10" is a subtraction,
        // not 100 followed by -10) and over a checksum ("2*3" in a value is
        // multiplication). States where only one reading is valid are
        // unaffected.
        ...binaryLeft(PREC.ADD, [token(prec(1, "+")), token(prec(1, "-"))], $),
        ...binaryLeft(
          PREC.MULTIPLY,
          [token(prec(1, "*")), "/", "//", "%", caseInsensitiveWords(["mod"])],
          $,
        ),
        prec.right(
          PREC.POWER,
          seq(
            field("left", $._expression),
            field("operator", token(prec(1, "**"))),
            field("right", $._expression),
          ),
        ),
      ),

    conditional_expression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        choice(
          seq($._expression, "?", $._expression, ":", $._expression),
          seq(
            $._expression,
            "if",
            repeat($._newline),
            $._expression,
            "else",
            repeat($._newline),
            $._expression,
          ),
        ),
      ),

    filter_expression: ($) =>
      prec.left(
        PREC.POSTFIX,
        seq(
          field("value", $._expression),
          choice("|", continuationOp("|")),
          repeat($._newline),
          field("filter", $.identifier),
          optional($.argument_list),
        ),
      ),

    not_in_operator: (_) =>
      new RegExp(`${caseInsensitive("not")}[ \\t]+${caseInsensitive("in")}`),
    is_not_operator: (_) =>
      new RegExp(`${caseInsensitive("is")}[ \\t]+${caseInsensitive("not")}`),
    is_in_operator: (_) =>
      new RegExp(`${caseInsensitive("is")}[ \\t]+${caseInsensitive("in")}`),
    not_operator: (_) =>
      token(prec(2, new RegExp(`${caseInsensitive("not")}[ \\t]+`))),
    text_comparison_operator: (_) =>
      caseInsensitiveWords(["eq", "ne", "gt", "ge", "lt", "le"]),

    parameter_reference: (_) => token(prec(8, /#+(?:\d+|<[^>\r\n]+>)/)),
    // LinuxCNC indirection, where the parameter number is itself an
    // expression: "#[#1] = 0", "G1 X#[#<pointer>]". "#[" is one token so the
    // lexer can weigh it against a "#" comment as a whole.
    indirect_parameter_reference: ($) =>
      seq(field("prefix", $.parameter_bracket_start), $._expression, "]"),
    parameter_bracket_start: (_) => /#\[/,
    spaced_parameter_reference: ($) => seq("#", /<[^>\r\n]+>/),
    identifier: (_) => token(prec(1, /[A-Za-z_][A-Za-z0-9_]*/)),
    number: (_) =>
      /[-+]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0[xX][0-9A-Fa-f]+)/,
    string: ($) =>
      choice(
        $.double_quoted_string,
        $.single_quoted_string,
        $.multiline_quoted_string,
      ),
    // Jinja strings may span lines (jschuh-style usage docstrings). prec -3:
    // when the closing quote is on the same line, the regular tokens win.
    multiline_quoted_string: (_) =>
      token(prec(-3, seq('"', repeat(choice(/[^"\\]/, /\\./, '""')), '"'))),
    // '""' is RRF's escape for a literal quote inside a string.
    double_quoted_string: (_) =>
      token(seq('"', repeat(choice(/[^"\\\r\n]/, /\\./, '""')), '"')),
    single_quoted_string: (_) =>
      token(seq("'", repeat(choice(/[^'\\\r\n]/, /\\./)), "'")),
    boolean: (_) => token(prec(2, caseInsensitiveWords(["true", "false"]))),
    null: (_) => token(prec(2, caseInsensitiveWords(["null", "none"]))),
    colon: (_) => ":",
    comma: (_) => ",",
    // Same digit-run/letter boundary as extended_command, with one extra
    // rule: a dot right after digits stays numeric (X1.Y2. splits at Y), while
    // a dot after letters stays wordy (file.gco is one argument).
    bare_argument: (_) =>
      token(
        prec(
          -2,
          /(?:[^\s0-9;(){}\[\],:=*]|\d+(?:\.\d*)?[^\sA-Za-z0-9.;(){}\[\],:=*])*(?:\d+(?:\.\d*)?|[^\s0-9;(){}\[\],:=*])/,
        ),
      ),
  },
});

// Keyword line, optional trailing comment, hard newline — the shared shape of
// every RRF meta statement.
function rrfLine($, keyword, ...parts) {
  return prec.right(
    10,
    seq(
      field("keyword", keyword),
      ...parts,
      optional($.semicolon_comment),
      $._newline,
    ),
  );
}

// Newline-tolerant delimited list; trailing commas only where a dialect
// actually allows them (call argument lists).
// The newline-prefixed close variant lets a delimiter on its own line end
// the list even when an item (a string-concatenation chain, say) could also
// have continued across that newline.
function delimitedList($, open, close, item, { trailingComma = false } = {}) {
  return seq(
    open,
    listPadding($),
    optional(
      seq(
        commaSepWithNewlines1(item, $),
        ...(trailingComma ? [optional(",")] : []),
        listPadding($),
      ),
    ),
    choice(close, token(new RegExp(NL_RUN + "\\" + close))),
  );
}

// A single letter followed by a decimal operand, e.g. X10.5 or F-3e2.
function letterWord(letters, precedence) {
  return token(prec(precedence, new RegExp(`[${letters}]${DECIMAL}`)));
}

// A command code such as G1, M104.1, or T-1.
function codeWord(letters) {
  return token(prec(8, new RegExp(`[${letters}]${CODE_NUMBER}`)));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

// Multiline Klipper list/dict values carry per-element "#" comments.
function listPadding($) {
  return repeat(choice($._newline, $.list_comment));
}

function commaSepWithNewlines1(rule, $) {
  return seq(rule, repeat(seq(",", listPadding($), rule)));
}

// Newlines may follow the operator: brace expressions in RRF macros wrap
// long conditions after "&&". A newline BEFORE the operator (Jinja macros
// wrap before "or") cannot be a grammar-level repeat — the parser would have
// to pick the operator's precedence before seeing it — so continuationOp
// bakes the newline run into the operator token instead.
function binaryLeft(precedence, operators, $) {
  return operators.map((operator) =>
    prec.left(
      precedence,
      seq(
        field("left", $._expression),
        field("operator", operator),
        repeat($._newline),
        field("right", $._expression),
      ),
    ),
  );
}

// A word operator at the start of a continuation line. The trailing blank
// stands in for a word boundary (tree-sitter regex has no lookahead), so
// "\nor " continues an expression while "\norder" starts a new line.
function continuationWordOp(word) {
  return token(new RegExp(`${NL_RUN}${caseInsensitive(word)}[ \\t]`));
}

function continuationOp(symbol) {
  return token(new RegExp(NL_RUN + symbol.replace(/[|&]/g, "\\$&")));
}

function caseInsensitive(word) {
  return [...word]
    .map(
      (character) => `[${character.toLowerCase()}${character.toUpperCase()}]`,
    )
    .join("");
}

function caseInsensitiveWords(words) {
  return new RegExp(words.map(caseInsensitive).join("|"));
}
