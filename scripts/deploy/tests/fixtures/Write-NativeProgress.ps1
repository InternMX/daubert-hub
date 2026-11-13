# Inert fixture: emits progress like BuildKit, without contacting any service.
param([int]$Code = 0)
[Console]::Error.WriteLine('fictitious build progress')
exit $Code
