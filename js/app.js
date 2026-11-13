(() => {
  'use strict';

  const CLAVE = 'registroCaja.v1';
  const CAMPOS = [
    ['izipay', 'Izipay'],
    ['ganancia', 'Ganancia'],
    ['perdida', 'Pérdida'],
    ['reposicionCaja', 'Reposición a caja'],
    ['reposicionExterno', 'Reposición externo'],
  ];

  const $ = (s, el = document) => el.querySelector(s);
  const dinero = n => 'S/ ' + (Number(n) || 0).toFixed(2);
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const pad = n => String(n).padStart(2, '0');
  const claveFecha = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  // ---------- Almacenamiento ----------
  let datos = {};
  try { datos = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { datos = {}; }
  const guardar = () => {
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
  };

  const vacio = r => !r || (CAMPOS.every(([k]) => !num(r[k])) && !(r.movimientos || []).some(m => num(m.monto) || m.concepto));

  // ---------- Cálculos ----------
  function totalesDia(r = {}) {
    const movs = r.movimientos || [];
    const gastos = movs.filter(m => m.tipo === 'gasto').reduce((a, m) => a + num(m.monto), 0);
    const retiros = movs.filter(m => m.tipo === 'retiro').reduce((a, m) => a + num(m.monto), 0);
    const ingresos = num(r.ganancia) + num(r.reposicionCaja) + num(r.reposicionExterno);
    const egresos = num(r.perdida) + gastos + retiros;
    return { gastos, retiros, ingresos, egresos, neto: ingresos - egresos, izipay: num(r.izipay) };
  }

  // ---------- Estado de vista ----------
  const hoy = new Date();
  let anio = hoy.getFullYear();
  let mes = hoy.getMonth();

  const fmtMes = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' });
  const fmtDia = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'short' });

  // ---------- Render ----------
  function render(abrir) {
    $('#mesTitulo').textContent = fmtMes.format(new Date(anio, mes, 1));
    const cont = $('#dias');
    cont.innerHTML = '';
    const diasMes = new Date(anio, mes + 1, 0).getDate();
    for (let d = 1; d <= diasMes; d++) {
      cont.appendChild(crearDia(claveFecha(anio, mes, d), new Date(anio, mes, d)));
    }
    renderResumen();
    if (abrir) {
      const el = cont.querySelector(`[data-fecha="${abrir}"]`);
      if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  }

  function crearDia(fecha, dateObj) {
    const el = $('#tplDia').content.firstElementChild.cloneNode(true);
    el.dataset.fecha = fecha;
    $('.fecha', el).textContent = fmtDia.format(dateObj);
    if (fecha === claveFecha(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) el.classList.add('hoy');

    const form = $('.formDia', el);
    const r = datos[fecha] || {};
    CAMPOS.forEach(([k]) => { form.elements[k].value = r[k] ?? ''; });
    (r.movimientos || []).forEach(m => agregarMov(el, m));

    form.addEventListener('input', () => leerYGuardar(el));
    form.addEventListener('submit', e => e.preventDefault());
    $('.agregar', el).addEventListener('click', () => {
      const li = agregarMov(el);
      $('[name=concepto]', li).focus();
    });
    $('.borrar', el).addEventListener('click', () => {
      if (!confirm('¿Borrar todos los datos de este día?')) return;
      delete datos[fecha];
      guardar();
      form.reset();
      $('.movs', el).innerHTML = '';
      actualizarDia(el);
      renderResumen();
    });

    actualizarDia(el);
    return el;
  }

  function agregarMov(el, m = { tipo: 'gasto', concepto: '', monto: '' }) {
    const li = $('#tplMov').content.firstElementChild.cloneNode(true);
    $('[name=tipo]', li).value = m.tipo;
    $('[name=concepto]', li).value = m.concepto;
    $('[name=monto]', li).value = m.monto;
    $('[name=tipo]', li).addEventListener('change', () => leerYGuardar(el));
    $('.quitar', li).addEventListener('click', () => { li.remove(); leerYGuardar(el); });
    $('.movs', el).appendChild(li);
    return li;
  }

  function leerYGuardar(el) {
    const form = $('.formDia', el);
    const r = {};
    CAMPOS.forEach(([k]) => { r[k] = form.elements[k].value; });
    r.movimientos = [...el.querySelectorAll('.mov')].map(li => ({
      tipo: $('[name=tipo]', li).value,
      concepto: $('[name=concepto]', li).value.trim(),
      monto: $('[name=monto]', li).value,
    }));
    if (vacio(r)) delete datos[el.dataset.fecha];
    else datos[el.dataset.fecha] = r;
    guardar();
    actualizarDia(el);
    renderResumen();
  }

  function actualizarDia(el) {
    const r = datos[el.dataset.fecha];
    const t = totalesDia(r);
    el.classList.toggle('con-datos', !vacio(r));
    const neto = $('.neto', el);
    neto.textContent = vacio(r) ? '—' : dinero(t.neto);
    neto.className = 'neto ' + (vacio(r) ? '' : t.neto >= 0 ? 'pos' : 'neg');

    $('.totales', el).innerHTML = `
      <div><span>Izipay</span><span>${dinero(t.izipay)}</span></div>
      <div><span>Ingresos (ganancia + reposiciones)</span><span class="pos">${dinero(t.ingresos)}</span></div>
      <div><span>Pérdida</span><span class="neg">${dinero(num(r?.perdida))}</span></div>
      <div><span>Gastos</span><span class="neg">${dinero(t.gastos)}</span></div>
      <div><span>Retiros</span><span class="neg">${dinero(t.retiros)}</span></div>
      <div class="final"><span>Neto del día</span><span class="${t.neto >= 0 ? 'pos' : 'neg'}">${dinero(t.neto)}</span></div>`;
  }

  function fechasDelMes() {
    const pref = `${anio}-${pad(mes + 1)}-`;
    return Object.keys(datos).filter(k => k.startsWith(pref)).sort();
  }

  function renderResumen() {
    const s = { izipay: 0, ganancia: 0, perdida: 0, reposicionCaja: 0, reposicionExterno: 0, gastos: 0, retiros: 0, neto: 0 };
    for (const f of fechasDelMes()) {
      const r = datos[f];
      const t = totalesDia(r);
      CAMPOS.forEach(([k]) => { s[k] += num(r[k]); });
      s.gastos += t.gastos;
      s.retiros += t.retiros;
      s.neto += t.neto;
    }
    const item = (lbl, v, cls = '') => `<div><small>${lbl}</small><b class="${cls}">${dinero(v)}</b></div>`;
    $('#resumenMes').innerHTML =
      CAMPOS.map(([k, lbl]) => item(lbl, s[k])).join('') +
      item('Gastos', s.gastos) +
      item('Retiros', s.retiros) +
      item('Neto del mes', s.neto, s.neto >= 0 ? 'pos' : 'neg');
  }

  // ---------- Exportar ----------
  function exportarCSV() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['Fecha', ...CAMPOS.map(c => c[1]), 'Gastos', 'Retiros', 'Detalle gastos/retiros', 'Neto']];
    for (const f of fechasDelMes()) {
      const r = datos[f];
      const t = totalesDia(r);
      const detalle = (r.movimientos || []).map(m => `${m.tipo}: ${m.concepto} ${num(m.monto).toFixed(2)}`).join('; ');
      filas.push([f, ...CAMPOS.map(([k]) => num(r[k]).toFixed(2)), t.gastos.toFixed(2), t.retiros.toFixed(2), detalle, t.neto.toFixed(2)]);
    }
    const csv = '﻿' + filas.map(fila => fila.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `caja-${anio}-${pad(mes + 1)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Eventos ----------
  $('#prev').addEventListener('click', () => { if (--mes < 0) { mes = 11; anio--; } render(); });
  $('#next').addEventListener('click', () => { if (++mes > 11) { mes = 0; anio++; } render(); });
  $('#irFecha').addEventListener('change', e => {
    if (!e.target.value) return;
    const [y, m] = e.target.value.split('-').map(Number);
    anio = y; mes = m - 1;
    render(e.target.value);
  });
  $('#exportar').addEventListener('click', exportarCSV);

  render(claveFecha(anio, mes, hoy.getDate()));
})();
