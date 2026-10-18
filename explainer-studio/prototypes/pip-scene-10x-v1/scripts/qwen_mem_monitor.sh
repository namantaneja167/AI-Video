#!/bin/zsh
# Samples memory pressure/swap every 2 s. Kills the generation PID if pressure level stays critical (4) for 5 consecutive samples.
# usage: qwen_mem_monitor.sh <csv> <pidfile> <stopfile>
CSV="$1"; PIDFILE="$2"; STOP="$3"; crit=0
echo "t,pressure_level,free_pct,swap_used_mb,pageouts,swapouts,swapins,compressor_pages,gen_pid_rss_gb" > "$CSV"
while [[ ! -e "$STOP" ]]; do
  lvl=$(sysctl -n kern.memorystatus_vm_pressure_level)
  free=$(memory_pressure | awk '/free percentage/{gsub("%","",$5); print $5}')
  swap=$(sysctl -n vm.swapusage | awk '{gsub("M","",$6); print $6}')
  vm=$(vm_stat)
  po=$(echo "$vm" | awk '/^Pageouts/{gsub("\\.","",$2); print $2}')
  so=$(echo "$vm" | awk '/^Swapouts/{gsub("\\.","",$2); print $2}')
  si=$(echo "$vm" | awk '/^Swapins/{gsub("\\.","",$2); print $2}')
  cp=$(echo "$vm" | awk '/occupied by compressor/{gsub("\\.","",$5); print $5}')
  pid=$(cat "$PIDFILE" 2>/dev/null); rss=""
  [[ -n "$pid" ]] && rss=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.2f",$1/1048576}')
  echo "$(date +%H:%M:%S),$lvl,$free,$swap,$po,$so,$si,$cp,$rss" >> "$CSV"
  if [[ "$lvl" == "4" ]]; then crit=$((crit+1)); else crit=0; fi
  if (( crit >= 5 )) && [[ -n "$pid" ]]; then echo "CRITICAL pressure sustained; killing generation pid $pid" >> "$CSV"; kill "$pid" 2>/dev/null; touch "$STOP.killed"; break; fi
  sleep 2
done
