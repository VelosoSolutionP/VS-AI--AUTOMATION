#!/usr/bin/env node
/**
 * Script que a TAREFA AGENDADA dispara após 7 dias — trava o teste na máquina do cliente.
 * Roda só se ainda estiver no prazo/plano trial (licença paga não é afetada).
 */
import { hardLock, trialStatus } from '../engine/trial-lock.mjs';

const s = trialStatus();
if (s.gerenciado && s.plan === 'trial') {
  hardLock('trial-7d');
  console.log('VelosoSolution: teste de 7 dias encerrado — travado.');
} else {
  console.log('VelosoSolution: sem trial gerenciado, nada a travar.');
}
