; ================================================================
; measure_idle_window.g -- Measure the prox idle window's width
; ================================================================
var nearEdge = move.axes[global.HLA_BUTTON_ENDSTOP_AXIS].machinePosition

G1 Z{global.HLA_Z_HOME_WINDOW_CLEAR_DEG * global.HLA_Z_CW_SIGN} F{global.HLA_Z_HOME_RELEASE_FEED_DEG_PER_MIN}
M400
if sensors.endstops[global.HLA_BUTTON_ENDSTOP_AXIS].triggered
  set global.HLA_LAST_ERROR = "measure_idle_window: idle window wider than HLA_Z_HOME_WINDOW_CLEAR_DEG"
  set global.HLA_LAST_ERROR_CODE = 504
  echo {"measure_idle_window: ABORT - " ^ global.HLA_LAST_ERROR}
  abort global.HLA_LAST_ERROR

G1 H4 Z{-2 * global.HLA_Z_HOME_WINDOW_CLEAR_DEG * global.HLA_Z_CW_SIGN} F{global.HLA_Z_HOME_RELEASE_FEED_DEG_PER_MIN}
M400
if !sensors.endstops[global.HLA_BUTTON_ENDSTOP_AXIS].triggered
  set global.HLA_LAST_ERROR = "measure_idle_window: could not re-find the idle window from the far side"
  set global.HLA_LAST_ERROR_CODE = 505
  echo {"measure_idle_window: ABORT - " ^ global.HLA_LAST_ERROR}
  abort global.HLA_LAST_ERROR

set global.HLA_MEASURED_WINDOW_DEG = abs(move.axes[global.HLA_BUTTON_ENDSTOP_AXIS].machinePosition - var.nearEdge)
M99

