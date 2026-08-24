/**
 * Thesa AI — Export Service (Enhanced 2026 Academic Edition)
 * Handles client-side generation of academic standard DOCX, PDF, Markdown, and BibTeX documents
 * with Indonesian Higher Education Cover Page, 4-4-3-3 Margins, and APA 7th Bibliography.
 */

const ThesaExportService = (function () {

  /**
   * Generates a Microsoft Word compatible HTML/Wordprocessing document
   */
  function buildWordDocumentHtml(meta, sections, options = {}) {
    const campus = meta.campus || meta.institution || 'Universitas Indonesia (UI)';
    const prodi = meta.prodi || 'Program Studi Ilmu Komputer & Sains Data';
    const fakultas = meta.fakultas || 'Fakultas Ilmu Komputer & Teknologi';
    const title = meta.title || 'Judul Penelitian Skripsi / Makalah Ilmiah';
    const docType = (meta.docType || meta.type || 'Skripsi').toUpperCase();
    const course = meta.course || (docType === 'SKRIPSI' ? 'Tugas Akhir / Skripsi' : 'Tugas Mata Kuliah');
    const lecturer = meta.lecturer || 'Dosen Pembimbing / Pengampu';
    const author = meta.author || meta.name || 'Mahasiswa Peneliti';
    const nim = meta.nim ? `NIM: ${meta.nim}` : 'NIM: —';
    const year = meta.year || new Date().getFullYear();

    const isSkripsi = docType.includes('SKRIPSI') || docType.includes('TESIS') || (sections && (sections.bab4 || sections.metodologi || sections.tinjauanPustaka));

    // Word Document Template with standard margins and Office styles
    return `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' 
            xmlns:w='urn:schemas-microsoft-com:office:word' 
            xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>${escapeXml(title)}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          @page {
            size: A4 portrait;
            margin: 4.0cm 3.0cm 3.0cm 4.0cm; /* Standar Indonesia: Kiri 4cm, Atas 4cm, Kanan 3cm, Bawah 3cm */
            mso-page-orientation: portrait;
          }
          @page Section1 {
            size: 21.0cm 29.7cm;
            margin: 4.0cm 3.0cm 3.0cm 4.0cm;
            mso-header-margin: 3.5cm;
            mso-footer-margin: 3.5cm;
            mso-paper-source: 0;
          }
          div.Section1 {
            page: Section1;
          }
          body {
            font-family: 'Times New Roman', Times, serif;
            font-size: 12pt;
            line-height: 1.5;
            color: #000000;
            text-align: justify;
          }
          .cover-page {
            page-break-after: always;
            text-align: center;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .cover-title {
            font-size: 14pt;
            font-weight: bold;
            text-transform: uppercase;
            margin-top: 20pt;
            margin-bottom: 30pt;
            line-height: 1.3;
          }
          .cover-sub {
            font-size: 12pt;
            margin-bottom: 40pt;
            line-height: 1.4;
          }
          .cover-logo-box {
            margin: 30pt auto 40pt auto;
            width: 120pt;
            height: 120pt;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1pt dashed #999;
            font-size: 10pt;
            color: #666;
          }
          .cover-author-box {
            font-size: 12pt;
            margin-bottom: 50pt;
            line-height: 1.4;
          }
          .cover-inst-box {
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            line-height: 1.3;
            margin-top: auto;
            margin-bottom: 10pt;
          }
          .page-break {
            page-break-before: always;
            mso-break-type: page-break;
          }
          h1.chapter-head {
            font-size: 12pt;
            font-weight: bold;
            text-align: center;
            text-transform: uppercase;
            margin-top: 18pt;
            margin-bottom: 12pt;
          }
          h2.section-head {
            font-size: 12pt;
            font-weight: bold;
            text-align: left;
            margin-top: 14pt;
            margin-bottom: 6pt;
          }
          h3.subsection-head {
            font-size: 12pt;
            font-weight: bold;
            font-style: italic;
            text-align: left;
            margin-top: 10pt;
            margin-bottom: 4pt;
          }
          p.academic-paragraph {
            text-indent: 1.27cm; /* 0.5 inch first-line indent */
            margin-top: 0pt;
            margin-bottom: 6pt;
            line-height: 1.5;
            text-align: justify;
          }
          .bib-item {
            padding-left: 1.27cm;
            text-indent: -1.27cm; /* Hanging indent for APA bibliography */
            margin-bottom: 6pt;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="Section1">
          <!-- HALAMAN COVER / JUDUL -->
          <div class="cover-page">
            <div class="cover-title">
              ${escapeXml(title)}
            </div>

            <div class="cover-sub">
              <strong>${escapeXml(docType)}</strong><br>
              ${isSkripsi ? 'Diajukan untuk Memenuhi Salah Satu Syarat Kelulusan Akademik' : `Disusun untuk Memenuhi Tugas Mata Kuliah: <strong>${escapeXml(course)}</strong>`}<br>
              ${lecturer ? `Dosen Pembimbing / Pengampu: <strong>${escapeXml(lecturer)}</strong>` : ''}
            </div>

            <div class="cover-logo-box">
              [ LOGO INSTITUSI / KAMPUS ]
            </div>

            <div class="cover-author-box">
              Disusun Oleh:<br><br>
              <strong>${escapeXml(author)}</strong><br>
              ${escapeXml(nim)}
            </div>

            <div class="cover-inst-box">
              ${escapeXml(prodi)}<br>
              ${escapeXml(fakultas)}<br>
              ${escapeXml(campus)}<br>
              ${year}
            </div>
          </div>

          <div class="page-break"></div>

          ${renderDocumentBody(sections, isSkripsi)}

          <div class="page-break"></div>

          <!-- DAFTAR PUSTAKA -->
          <h1 class="chapter-head">DAFTAR PUSTAKA</h1>
          ${formatBibliography(sections.daftarPustaka || sections.references)}
        </div>
      </body>
      </html>
    `;
  }

  function renderDocumentBody(sections, isSkripsi) {
    if (!sections) return '<p class="academic-paragraph"><em>(Draf belum tersedia)</em></p>';

    // If dynamic custom chapters array is provided
    if (Array.isArray(sections.chapters)) {
      return sections.chapters.map((ch, idx) => {
        let out = `${idx > 0 ? '<div class="page-break"></div>' : ''}
          <h1 class="chapter-head">${escapeXml(ch.title || `BAB ${idx+1}`)}</h1>`;
        if (ch.content) {
          out += formatParagraphs(ch.content);
        }
        if (Array.isArray(ch.subsections)) {
          ch.subsections.forEach(sub => {
            out += `<h2 class="section-head">${escapeXml(sub.title)}</h2>`;
            out += formatParagraphs(sub.content);
          });
        }
        return out;
      }).join('\n');
    }

    // Skripsi 5 Bab Standar DIKTI
    if (isSkripsi) {
      return `
        <!-- BAB I -->
        <h1 class="chapter-head">BAB I<br>PENDAHULUAN</h1>
        <h2 class="section-head">1.1 Latar Belakang Masalah</h2>
        ${formatParagraphs(sections.latarBelakang || sections.bab1_1 || 'Latar belakang masalah memuat fenomena empiris dan kesenjangan riset.')}

        <h2 class="section-head">1.2 Rumusan Masalah</h2>
        ${formatParagraphs(sections.rumusanMasalah || sections.bab1_2 || 'Rumusan masalah penelitian.')}

        <h2 class="section-head">1.3 Tujuan Penelitian</h2>
        ${formatParagraphs(sections.tujuan || sections.bab1_3 || 'Tujuan umum dan khusus penelitian.')}

        <h2 class="section-head">1.4 Manfaat Penelitian</h2>
        ${formatParagraphs(sections.manfaat || sections.bab1_4 || 'Manfaat teoritis dan praktis.')}

        <div class="page-break"></div>

        <!-- BAB II -->
        <h1 class="chapter-head">BAB II<br>TINJAUAN PUSTAKA</h1>
        <h2 class="section-head">2.1 Landasan Teori</h2>
        ${formatParagraphs(sections.landasanTeori || sections.bab2_1 || 'Landasan teoritis pendukung riset.')}

        <h2 class="section-head">2.2 Penelitian Terdahulu (State of the Art)</h2>
        ${formatParagraphs(sections.penelitianTerdahulu || sections.bab2_2 || 'Review literatur dan gap penelitian.')}

        <h2 class="section-head">2.3 Kerangka Pemikiran</h2>
        ${formatParagraphs(sections.kerangkaPemikiran || sections.bab2_3 || 'Alur pikir konseptual penelitian.')}

        <div class="page-break"></div>

        <!-- BAB III -->
        <h1 class="chapter-head">BAB III<br>METODOLOGI PENELITIAN</h1>
        <h2 class="section-head">3.1 Desain Penelitian</h2>
        ${formatParagraphs(sections.desainPenelitian || sections.metodologi || sections.bab3_1 || 'Pendekatan dan desain metodologi.')}

        <h2 class="section-head">3.2 Sumber Data & Instrumen</h2>
        ${formatParagraphs(sections.sumberData || sections.bab3_2 || 'Populasi, sampel, dataset, atau instrumen.')}

        <h2 class="section-head">3.3 Teknik Analisis Data</h2>
        ${formatParagraphs(sections.analisisData || sections.bab3_3 || 'Metode analisis kuantitatif / kualitatif / algoritma.')}

        <div class="page-break"></div>

        <!-- BAB IV -->
        <h1 class="chapter-head">BAB IV<br>HASIL DAN PEMBAHASAN</h1>
        <h2 class="section-head">4.1 Hasil Analisis</h2>
        ${formatParagraphs(sections.hasil || sections.bab4_1 || sections.pembahasan || 'Temuan dan hasil pengujian empiris.')}

        <h2 class="section-head">4.2 Diskusi Akademik</h2>
        ${formatParagraphs(sections.diskusi || sections.bab4_2 || 'Sintesis hasil dengan literatur terkait.')}

        <div class="page-break"></div>

        <!-- BAB V -->
        <h1 class="chapter-head">BAB V<br>KESIMPULAN DAN SARAN</h1>
        <h2 class="section-head">5.1 Kesimpulan</h2>
        ${formatParagraphs(sections.kesimpulan || sections.bab5_1 || 'Kesimpulan menyeluruh riset.')}

        <h2 class="section-head">5.2 Saran & Rekomendasi</h2>
        ${formatParagraphs(sections.saran || sections.bab5_2 || 'Rekomendasi praktis dan agenda riset lanjutan.')}
      `;
    }

    // Makalah 3 Bab Standar
    return `
      <!-- ISI NASKAH MAKALAH (3 BAB) -->
      <h1 class="chapter-head">BAB I<br>PENDAHULUAN</h1>
      <h2 class="section-head">1.1 Latar Belakang Masalah</h2>
      ${formatParagraphs(sections.latarBelakang || 'Latar belakang masalah belum terisi.')}

      <h2 class="section-head">1.2 Rumusan Masalah</h2>
      ${formatParagraphs(sections.rumusanMasalah || 'Rumusan masalah belum terisi.')}

      <h2 class="section-head">1.3 Tujuan Penulisan</h2>
      ${formatParagraphs(sections.tujuan || 'Tujuan penulisan belum terisi.')}

      <div class="page-break"></div>

      <h1 class="chapter-head">BAB II<br>PEMBAHASAN DAN ANALISIS</h1>
      ${formatParagraphs(sections.pembahasan || 'Pembahasan dan analisis belum terisi.')}

      <div class="page-break"></div>

      <h1 class="chapter-head">BAB III<br>PENUTUP</h1>
      <h2 class="section-head">3.1 Kesimpulan</h2>
      ${formatParagraphs(sections.kesimpulan || 'Kesimpulan belum terisi.')}

      <h2 class="section-head">3.2 Saran dan Rekomendasi</h2>
      ${formatParagraphs(sections.saran || 'Saran belum terisi.')}
    `;
  }

  function formatParagraphs(text) {
    if (!text) return '<p class="academic-paragraph"><em>(Belum ada draf)</em></p>';
    
    if (text.includes('<p>') || text.includes('<div>')) {
      return text.replace(/<p[^>]*>/gi, '<p class="academic-paragraph">');
    }

    return text.split(/\n\n+/).map(p => {
      const clean = p.trim();
      return clean ? `<p class="academic-paragraph">${escapeXml(clean)}</p>` : '';
    }).join('\n');
  }

  function formatBibliography(refs) {
    if (!refs || refs.length === 0) {
      return '<p class="academic-paragraph"><em>(Daftar pustaka belum ditambahkan)</em></p>';
    }

    if (Array.isArray(refs)) {
      const sorted = [...refs].sort((a, b) => {
        const textA = (typeof a === 'string' ? a : (a.bib || a.authors || a.title || '')).toLowerCase();
        const textB = (typeof b === 'string' ? b : (b.bib || b.authors || b.title || '')).toLowerCase();
        return textA.localeCompare(textB);
      });

      return sorted.map(r => {
        const entry = typeof r === 'string' ? r : (r.bib || `${escapeXml(r.authors)} (${r.year || 2024}). ${escapeXml(r.title)}. <em>${escapeXml(r.journal || 'Jurnal Ilmiah')}</em>.`);
        return `<p class="bib-item">${entry}</p>`;
      }).join('\n');
    }

    return `<div class="bib-container">${refs}</div>`;
  }

  function escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Triggers download of standard Microsoft Word (.doc) file
   */
  function exportToDocx(meta, sections) {
    const htmlContent = buildWordDocumentHtml(meta, sections);
    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword'
    });

    const safeTitle = (meta.title || 'Naskah_Skripsi_Thesa')
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    const filename = `${safeTitle}.doc`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Opens Print / PDF export dialog with clean academic layout
   */
  function exportToPdf(meta, sections) {
    const htmlContent = buildWordDocumentHtml(meta, sections);
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) {
      alert('⚠️ Silakan izinkan pop-up browser untuk mencetak / menyimpan naskah ke PDF.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    printWindow.onload = function () {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    };
  }

  /**
   * Exports academic paper to clean Markdown (.md)
   */
  function exportToMarkdown(meta, sections) {
    const title = meta.title || 'Judul Penelitian';
    const author = meta.author || meta.name || 'Mahasiswa Peneliti';
    const campus = meta.campus || meta.institution || 'Universitas Indonesia';
    const year = meta.year || new Date().getFullYear();

    let md = `---
title: "${title}"
author: "${author}"
institution: "${campus}"
year: ${year}
generator: "Thesa AI Academic Engine"
---

# ${title}

**Penulis**: ${author}  
**Institusi**: ${campus} (${year})  

---

## BAB I: PENDAHULUAN

### 1.1 Latar Belakang Masalah
${sections.latarBelakang || sections.bab1_1 || '_Belum terisi_'}

### 1.2 Rumusan Masalah
${sections.rumusanMasalah || sections.bab1_2 || '_Belum terisi_'}

### 1.3 Tujuan Penelitian
${sections.tujuan || sections.bab1_3 || '_Belum terisi_'}

---

## BAB II: TINJAUAN PUSTAKA

### 2.1 Landasan Teori
${sections.landasanTeori || sections.pembahasan || '_Belum terisi_'}

### 2.2 State of the Art & Gap Penelitian
${sections.penelitianTerdahulu || '_Belum terisi_'}

---

## BAB III: METODOLOGI PENELITIAN
${sections.desainPenelitian || sections.metodologi || '_Belum terisi_'}

---

## BAB IV: HASIL DAN PEMBAHASAN
${sections.hasil || sections.pembahasan || '_Belum terisi_'}

---

## BAB V: KESIMPULAN DAN SARAN

### 5.1 Kesimpulan
${sections.kesimpulan || '_Belum terisi_'}

### 5.2 Saran
${sections.saran || '_Belum terisi_'}

---

## DAFTAR PUSTAKA
`;

    const refs = sections.daftarPustaka || sections.references || [];
    if (Array.isArray(refs)) {
      refs.forEach((r, i) => {
        const item = typeof r === 'string' ? r : (r.bib || `${r.authors} (${r.year}). ${r.title}. *${r.journal || 'Jurnal'}*.`);
        md += `\n${i+1}. ${item}`;
      });
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const safeTitle = (meta.title || 'Naskah_Thesa')
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeTitle}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Exports academic references to BibTeX (.bib)
   */
  function exportToBibTex(meta, references) {
    const refs = references || [];
    let bibContent = `% BibTeX Bibliography generated by Thesa AI\n% Project: ${meta.title || 'Skripsi'}\n\n`;

    refs.forEach((ref, idx) => {
      if (typeof ref === 'string') {
        bibContent += `@article{ref_${idx+1},\n  title={${ref}},\n  year={2024}\n}\n\n`;
      } else {
        const key = (ref.authors ? ref.authors.split(',')[0].trim().toLowerCase().replace(/[^a-z]/g, '') : 'ref') + (ref.year || 2024);
        bibContent += `@article{${key}_${idx+1},\n`;
        bibContent += `  author = {${ref.authors || 'Unknown'}},\n`;
        bibContent += `  title = {${ref.title || 'Untitled'}},\n`;
        bibContent += `  journal = {${ref.journal || 'Academic Journal'}},\n`;
        bibContent += `  year = {${ref.year || 2024}},\n`;
        if (ref.doi) bibContent += `  doi = {${ref.doi}},\n`;
        bibContent += `}\n\n`;
      }
    });

    const blob = new Blob([bibContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `references_${new Date().getFullYear()}.bib`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return {
    exportToDocx,
    exportToPdf,
    exportToMarkdown,
    exportToBibTex,
    buildWordDocumentHtml
  };
})();

// Export globally
if (typeof window !== 'undefined') {
  window.ThesaExportService = ThesaExportService;
}
