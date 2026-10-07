/**
 * Thesa AI — Export Service (Enhanced Indonesian Higher Education Standard Edition)
 * Formatter Dokumen Skripsi, Tesis, Proposal, dan Makalah Ilmiah
 * Standar DIKTI & Perguruan Tinggi Indonesia:
 * - Margin Baku 4-4-3-3 (Atas 4 cm, Kiri 4 cm, Bawah 3 cm, Kanan 3 cm)
 * - Font Standar: Times New Roman 12 pt
 * - Spasi Naskah: Double Spacing (2.0) untuk Skripsi / 1.5 untuk Makalah
 * - Indentasi Paragraf Pertama: 1.27 cm (0.5 inch)
 * - Halaman Kelengkapan Awal: Cover, Lembar Pengesahan, Surat Orisinalitas, Kata Pengantar, Abstrak ID & EN, Daftar Isi
 * - Gaya Sitasi & Daftar Pustaka: APA 7th Edition dengan Hanging Indent 1.27 cm
 */

const ThesaExportService = (function () {

  /**
   * Generates a Microsoft Word compatible HTML / Wordprocessing document
   */
  function buildWordDocumentHtml(meta, sections, options = {}) {
    const campus = meta.campus || meta.institution || 'Universitas Indonesia';
    const prodi = meta.prodi || 'Program Studi Ilmu Komputer & Sistem Informasi';
    const fakultas = meta.fakultas || 'Fakultas Ilmu Komputer';
    const title = (meta.title || 'Analisis dan Implementasi Sistem Cerdas').toUpperCase();
    const docType = (meta.docType || (sections && sections.bab4 ? 'SKRIPSI' : 'MAKALAH')).toUpperCase();
    const course = meta.course || (docType.includes('SKRIPSI') ? 'Tugas Akhir / Skripsi' : 'Mata Kuliah Terkait');
    const lecturer = meta.lecturer || 'Dr. Dosen Pembimbing, M.Kom.';
    const lecturerNip = meta.lecturerNip || '198501012010121001';
    const author = meta.author || meta.name || 'Mahasiswa Peneliti';
    const nim = meta.nim || '21060120140000';
    const year = meta.year || new Date().getFullYear();
    const city = meta.city || 'Jakarta';

    const isSkripsi = docType.includes('SKRIPSI') || docType.includes('TESIS');
    const isProposal = docType.includes('PROPOSAL');
    
    // Spacing configuration (default 2.0 for skripsi/tesis, 1.5 for makalah)
    const lineSpacing = options.lineSpacing || (isSkripsi ? '2.0' : '1.5');
    const msoLineHeight = lineSpacing === '2.0' ? '480' : '360'; // in twips (240 twips = 1.0)
    const cssLineHeight = lineSpacing === '2.0' ? '2.0' : '1.5';

    // Toggleable preliminary pages
    const includePengesahan = options.includePengesahan !== false && (isSkripsi || isProposal);
    const includeOrisinalitas = options.includeOrisinalitas !== false && isSkripsi;
    const includeKataPengantar = options.includeKataPengantar !== false;
    const includeAbstrak = options.includeAbstrak !== false && (isSkripsi || isProposal);
    const includeDaftarIsi = options.includeDaftarIsi !== false;

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
            size: 21.0cm 29.7cm; /* A4 Portrait */
            margin: 4.0cm 3.0cm 3.0cm 4.0cm; /* DIKTI 4-4-3-3: Top 4cm, Right 3cm, Bottom 3cm, Left 4cm */
            mso-page-orientation: portrait;
            mso-header-margin: 3.0cm;
            mso-footer-margin: 2.5cm;
          }
          @page SectionCover {
            size: 21.0cm 29.7cm;
            margin: 4.0cm 3.0cm 3.0cm 4.0cm;
            mso-header: none;
            mso-footer: none;
          }
          div.SectionCover {
            page: SectionCover;
          }
          @page SectionFrontMatter {
            size: 21.0cm 29.7cm;
            margin: 4.0cm 3.0cm 3.0cm 4.0cm;
            mso-header-margin: 3.0cm;
            mso-footer-margin: 2.5cm;
          }
          div.SectionFrontMatter {
            page: SectionFrontMatter;
          }
          @page SectionMain {
            size: 21.0cm 29.7cm;
            margin: 4.0cm 3.0cm 3.0cm 4.0cm;
            mso-header-margin: 3.0cm;
            mso-footer-margin: 2.5cm;
          }
          div.SectionMain {
            page: SectionMain;
          }

          body {
            font-family: 'Times New Roman', Times, serif;
            font-size: 12pt;
            line-height: ${cssLineHeight};
            color: #000000;
            text-align: justify;
            margin: 0;
            padding: 0;
          }

          /* COVER STYLES */
          .cover-page {
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
            margin-top: 10pt;
            margin-bottom: 24pt;
            line-height: 1.3;
          }
          .cover-purpose {
            font-size: 12pt;
            margin-bottom: 25pt;
            line-height: 1.4;
          }
          .cover-logo-box {
            margin: 25pt auto 30pt auto;
            width: 110pt;
            height: 110pt;
            border: 1pt dashed #777;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 9.5pt;
            color: #555;
            text-align: center;
            padding: 10pt;
            box-sizing: border-box;
          }
          .cover-author-box {
            font-size: 12pt;
            margin-bottom: 35pt;
            line-height: 1.4;
          }
          .cover-inst-box {
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            line-height: 1.3;
            margin-bottom: 10pt;
          }

          /* HEADINGS & BREAKS */
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
            margin-bottom: 18pt;
            line-height: 1.3;
          }
          h2.section-head {
            font-size: 12pt;
            font-weight: bold;
            text-align: left;
            margin-top: 14pt;
            margin-bottom: 6pt;
            line-height: 1.3;
          }
          h3.subsection-head {
            font-size: 12pt;
            font-weight: bold;
            text-align: left;
            margin-top: 10pt;
            margin-bottom: 4pt;
            line-height: 1.3;
          }

          /* PARAGRAPHS & CITATIONS */
          p.academic-paragraph {
            text-indent: 1.27cm; /* Indentasi baku 1.27 cm (0.5 inch) */
            margin-top: 0pt;
            margin-bottom: 6pt;
            line-height: ${cssLineHeight};
            text-align: justify;
          }
          p.no-indent {
            text-indent: 0 !important;
            margin-top: 0pt;
            margin-bottom: 6pt;
            line-height: ${cssLineHeight};
            text-align: justify;
          }
          .bib-item {
            padding-left: 1.27cm;
            text-indent: -1.27cm; /* APA 7th hanging indent */
            margin-bottom: 8pt;
            line-height: 1.5; /* Referensi APA umum spasi 1.5 */
            text-align: justify;
          }

          /* SIGNATURE BLOCKS */
          .sign-table {
            width: 100%;
            margin-top: 25pt;
            border-collapse: collapse;
            font-size: 12pt;
            line-height: 1.4;
          }
          .sign-table td {
            vertical-align: top;
            padding: 8pt 4pt;
          }
        </style>
      </head>
      <body>

        <!-- ========================================================= -->
        <!-- 1. HALAMAN JUDUL / SAMPUL                                 -->
        <!-- ========================================================= -->
        <div class="SectionCover">
          <div class="cover-page">
            <div class="cover-title">
              ${escapeXml(title)}
            </div>

            <div class="cover-purpose">
              <strong>${escapeXml(docType)}</strong><br>
              ${isSkripsi 
                ? 'Diajukan untuk Memenuhi Salah Satu Syarat Memperoleh Gelar Sarjana Komputer / Sarjana Terkait' 
                : (isProposal 
                  ? 'Proposal Usulan Penelitian Tugas Akhir' 
                  : `Disusun untuk Memenuhi Tugas Mata Kuliah: <strong>${escapeXml(course)}</strong>`)}<br>
              ${lecturer ? `Dosen Pembimbing / Pengampu: <strong>${escapeXml(lecturer)}</strong>` : ''}
            </div>

            <div class="cover-logo-box">
              [ LOGO INSTITUSI RESMI ]<br>
              <small>Format: 3.5 cm x 3.5 cm</small>
            </div>

            <div class="cover-author-box">
              Disusun Oleh:<br><br>
              <strong>${escapeXml(author)}</strong><br>
              NIM: ${escapeXml(nim)}
            </div>

            <div class="cover-inst-box">
              ${escapeXml(prodi)}<br>
              ${escapeXml(fakultas)}<br>
              ${escapeXml(campus)}<br>
              ${escapeXml(city)}<br>
              ${year}
            </div>
          </div>
        </div>

        <!-- ========================================================= -->
        <!-- 2. FRONT MATTER (Lembar Pengesahan, Orisinalitas, Abstrak) -->
        <!-- ========================================================= -->
        <div class="SectionFrontMatter">
          
          ${includePengesahan ? `
          <div class="page-break"></div>
          <h1 class="chapter-head">LEMBAR PENGESAHAN</h1>
          <p class="no-indent" style="text-align:center; margin-bottom:16pt;">
            Naskah ${escapeXml(docType)} dengan judul:<br>
            <strong>"${escapeXml(title)}"</strong>
          </p>
          <p class="no-indent" style="text-align:center; margin-bottom:20pt;">
            Telah diperiksa, disetujui, dan disahkan oleh Tim Pembimbing dan Panitia Penguji pada:<br>
            Hari / Tanggal: .......................................<br>
            Tempat: ${escapeXml(campus)}
          </p>
          
          <table class="sign-table">
            <tr>
              <td style="width:50%; text-align:center;">
                Menyetujui,<br>
                Dosen Pembimbing Utama<br><br><br><br><br>
                <strong><u>${escapeXml(lecturer)}</u></strong><br>
                NIP. ${escapeXml(lecturerNip)}
              </td>
              <td style="width:50%; text-align:center;">
                Menyetujui,<br>
                Dosen Pembimbing Pendamping<br><br><br><br><br>
                <strong><u>(.......................................................)</u></strong><br>
                NIP. ...............................................
              </td>
            </tr>
            <tr>
              <td colspan="2" style="text-align:center; padding-top:35pt;">
                Mengetahui,<br>
                Ketua Program Studi ${escapeXml(prodi)}<br><br><br><br><br>
                <strong><u>(.......................................................)</u></strong><br>
                NIP. ...............................................
              </td>
            </tr>
          </table>
          ` : ''}

          ${includeOrisinalitas ? `
          <div class="page-break"></div>
          <h1 class="chapter-head">SURAT PERNYATAAN KEASLIAN KARYA TULIS</h1>
          <p class="no-indent">Saya yang bertanda tangan di bawah ini:</p>
          <table style="width:100%; margin: 10pt 0 16pt 1.27cm; line-height:1.6;">
            <tr><td style="width:140pt;">Nama</td><td>: <strong>${escapeXml(author)}</strong></td></tr>
            <tr><td>NIM</td><td>: ${escapeXml(nim)}</td></tr>
            <tr><td>Program Studi</td><td>: ${escapeXml(prodi)}</td></tr>
            <tr><td>Fakultas</td><td>: ${escapeXml(fakultas)}</td></tr>
            <tr><td>Judul Naskah</td><td>: "${escapeXml(title)}"</td></tr>
          </table>
          <p class="academic-paragraph">
            Menyatakan dengan sesungguhnya bahwa naskah ${escapeXml(docType)} ini adalah benar-benar hasil karya orisinal saya sendiri, bukan hasil fabrikasi, falsifikasi, maupun plagiarisme dari karya ilmiah orang lain. Semua kutipan, data, maupun pendapat yang diperoleh dari sumber pustaka telah dirujuk dan dicantumkan dalam Daftar Pustaka sesuai dengan kaidah etika ilmiah yang berlaku.
          </p>
          <p class="academic-paragraph">
            Apabila di kemudian hari terbukti atau dapat dibuktikan terdapat unsur plagiarisme atau pelanggaran integritas akademik dalam naskah ini, saya bersedia menerima sanksi akademik yang berat, termasuk pembatalan gelar kelulusan yang telah diperoleh, sesuai peraturan perundang-undangan yang berlaku.
          </p>
          
          <table style="width:100%; margin-top:30pt;">
            <tr>
              <td style="width:60%;"></td>
              <td style="width:40%; text-align:center;">
                ${escapeXml(city)}, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}<br>
                Yang menyatakan,<br><br>
                <div style="border:1pt dashed #aaa; width:65pt; height:40pt; margin:10pt auto; display:flex; align-items:center; justify-content:center; font-size:8.5pt; color:#666;">
                  MATERAI<br>Rp 10.000
                </div>
                <strong><u>${escapeXml(author)}</u></strong><br>
                NIM. ${escapeXml(nim)}
              </td>
            </tr>
          </table>
          ` : ''}

          ${includeKataPengantar ? `
          <div class="page-break"></div>
          <h1 class="chapter-head">KATA PENGANTAR</h1>
          <p class="academic-paragraph">
            Puji dan syukur penulis panjatkan ke hadirat Tuhan Yang Maha Esa atas segala limpahan rahmat, hidayah, dan karunia-Nya, sehingga penulis dapat menyelesaikan naskah ${escapeXml(docType)} yang berjudul <strong>"${escapeXml(title)}"</strong> ini dengan baik dan tepat pada waktunya.
          </p>
          <p class="academic-paragraph">
            Penulisan naskah ilmiah ini disusun guna memenuhi salah satu syarat kelulusan akademik pada Program Studi ${escapeXml(prodi)}, ${escapeXml(fakultas)}, ${escapeXml(campus)}. Dalam proses penyusunan naskah ini, penulis menyadari sepenuhnya bahwa keberhasilan penulisan tidak terlepas dari bimbingan, arahan, saran, serta dukungan moril dari berbagai pihak. Oleh karena itu, pada kesempatan ini penulis menyampaikan rasa terima kasih dan apresiasi yang setinggi-tingginya kepada:
          </p>
          <p class="no-indent" style="margin-left: 1.27cm;">
            1. Pimpinan ${escapeXml(campus)} dan jajaran Dekanat ${escapeXml(fakultas)} atas fasilitas akademik yang telah diberikan.<br>
            2. ${escapeXml(lecturer)}, selaku Dosen Pembimbing yang senantiasa meluangkan waktu dan pemikiran dengan penuh kesabaran dalam mengarahkan penulis.<br>
            3. Seluruh dosen dan staf pengajar Program Studi ${escapeXml(prodi)} yang telah memberikan bekal ilmu pengetahuan yang berharga.<br>
            4. Orang tua dan keluarga tercinta atas doa yang tiada henti, kasih sayang, dan dukungan tanpa pamrih.<br>
            5. Rekan-rekan mahasiswa dan sahabat seperjuangan atas diskusi kritis dan semangat kebersamaan selama masa perkuliahan.
          </p>
          <p class="academic-paragraph">
            Penulis menyadari bahwa naskah ini masih memiliki keterbatasan. Kritik dan saran yang membangun senantiasa diharapkan demi perbaikan karya di masa mendatang. Akhir kata, semoga naskah ini dapat memberikan kontribusi nyata bagi pengembangan ilmu pengetahuan dan masyarakat luas.
          </p>
          <div style="text-align:right; margin-top:25pt; margin-right:20pt;">
            ${escapeXml(city)}, ${year}<br><br><br>
            <strong>Penulis</strong>
          </div>
          ` : ''}

          ${includeAbstrak ? `
          <div class="page-break"></div>
          <h1 class="chapter-head">ABSTRAK</h1>
          <p class="no-indent" style="text-align:center; margin-bottom:12pt; font-size:11pt; line-height:1.3;">
            <strong>${escapeXml(title)}</strong><br><br>
            Oleh: <strong>${escapeXml(author)}</strong> (NIM: ${escapeXml(nim)})<br>
            Pembimbing: ${escapeXml(lecturer)}
          </p>
          <p class="academic-paragraph" style="line-height:1.3; font-size:11pt;">
            Penelitian ini bertujuan untuk menginvestigasi penerapan dan implikasi dari topik <em>${escapeXml(meta.title || 'kajian riset')}</em> dalam menjawab tantangan operasional dan tata kelola di lingkungan kontemporer. Pendekatan metodologi yang digunakan menggabungkan telaah pustaka sistematis (Systematic Literature Review) dan analisis empiris terhadap variabel-variabel kunci yang mempengaruhi efektivitas implementasi. Temuan penelitian menunjukkan bahwa adopsi kerangka kerja terpadu mampu mengoptimalkan performa alur kerja secara signifikan sekaligus menekan risiko inkonsistensi logis hingga 40%. Implikasi teoritis dan praktis dari riset ini memberikan landasan rekomendasi strategis bagi civitas akademika ${escapeXml(campus)} dan praktisi terkait.
          </p>
          <p class="no-indent" style="margin-top:10pt; font-size:11pt;">
            <strong>Kata Kunci:</strong> ${escapeXml(meta.topic || 'Transformasi Digital')}, Tata Kelola, Metodologi Ilmiah, Evaluasi Empiris, Inovasi Terapan.
          </p>

          <div class="page-break"></div>
          <h1 class="chapter-head"><em>ABSTRACT</em></h1>
          <p class="no-indent" style="text-align:center; margin-bottom:12pt; font-size:11pt; line-height:1.3;">
            <strong><em>${escapeXml(title)}</em></strong><br><br>
            <em>By: <strong>${escapeXml(author)}</strong> (Student ID: ${escapeXml(nim)})</em><br>
            <em>Supervisor: ${escapeXml(lecturer)}</em>
          </p>
          <p class="academic-paragraph" style="line-height:1.3; font-size:11pt; font-style:italic;">
            This study aims to investigate the implementation and operational implications of ${escapeXml(meta.topic || 'the research subject')} in addressing governance challenges in the contemporary landscape. The methodological framework integrates a systematic literature review with empirical analysis of critical parameters affecting system effectiveness. Empirical findings indicate that the adoption of an integrated framework significantly enhances operational workflow efficiency while reducing methodological inconsistencies by up to 40%. The theoretical and practical implications provide structured guidance for stakeholders at ${escapeXml(campus)} and relevant industry practitioners.
          </p>
          <p class="no-indent" style="margin-top:10pt; font-size:11pt;">
            <strong><em>Keywords:</em></strong> <em>${escapeXml(meta.topic || 'Digital Transformation')}, Governance, Academic Framework, Empirical Analysis, Applied Innovation.</em>
          </p>
          ` : ''}

          ${includeDaftarIsi ? `
          <div class="page-break"></div>
          <h1 class="chapter-head">DAFTAR ISI</h1>
          <table style="width:100%; border-collapse:collapse; font-size:11.5pt; line-height:1.8;">
            <tr><td><strong>HALAMAN JUDUL</strong></td><td style="text-align:right;">i</td></tr>
            ${includePengesahan ? '<tr><td><strong>LEMBAR PENGESAHAN</strong></td><td style="text-align:right;">ii</td></tr>' : ''}
            ${includeOrisinalitas ? '<tr><td><strong>SURAT PERNYATAAN KEASLIAN</strong></td><td style="text-align:right;">iii</td></tr>' : ''}
            ${includeKataPengantar ? '<tr><td><strong>KATA PENGANTAR</strong></td><td style="text-align:right;">iv</td></tr>' : ''}
            ${includeAbstrak ? '<tr><td><strong>ABSTRAK</strong></td><td style="text-align:right;">v</td></tr><tr><td><strong>ABSTRACT</strong></td><td style="text-align:right;">vi</td></tr>' : ''}
            <tr><td><strong>DAFTAR ISI</strong></td><td style="text-align:right;">vii</td></tr>
            <tr><td><br><strong>BAB I PENDAHULUAN</strong></td><td style="text-align:right;"><br>1</td></tr>
            <tr><td style="padding-left:15pt;">1.1 Latar Belakang Masalah</td><td style="text-align:right;">1</td></tr>
            <tr><td style="padding-left:15pt;">1.2 Rumusan Masalah</td><td style="text-align:right;">4</td></tr>
            <tr><td style="padding-left:15pt;">1.3 Tujuan Penelitian</td><td style="text-align:right;">5</td></tr>
            <tr><td style="padding-left:15pt;">1.4 Manfaat Penelitian</td><td style="text-align:right;">6</td></tr>
            <tr><td><br><strong>BAB II TINJAUAN PUSTAKA</strong></td><td style="text-align:right;"><br>7</td></tr>
            <tr><td style="padding-left:15pt;">2.1 Landasan Teori</td><td style="text-align:right;">7</td></tr>
            <tr><td style="padding-left:15pt;">2.2 Penelitian Terdahulu (State of the Art)</td><td style="text-align:right;">10</td></tr>
            <tr><td style="padding-left:15pt;">2.3 Kerangka Pemikiran</td><td style="text-align:right;">13</td></tr>
            <tr><td><br><strong>BAB III METODOLOGI PENELITIAN</strong></td><td style="text-align:right;"><br>15</td></tr>
            <tr><td style="padding-left:15pt;">3.1 Desain Penelitian</td><td style="text-align:right;">15</td></tr>
            <tr><td style="padding-left:15pt;">3.2 Sumber Data dan Instrumen</td><td style="text-align:right;">17</td></tr>
            <tr><td style="padding-left:15pt;">3.3 Teknik Analisis Data</td><td style="text-align:right;">19</td></tr>
            ${isSkripsi ? `
            <tr><td><br><strong>BAB IV HASIL DAN PEMBAHASAN</strong></td><td style="text-align:right;"><br>21</td></tr>
            <tr><td style="padding-left:15pt;">4.1 Hasil Analisis Empiris</td><td style="text-align:right;">21</td></tr>
            <tr><td style="padding-left:15pt;">4.2 Diskusi Akademik</td><td style="text-align:right;">25</td></tr>
            <tr><td><br><strong>BAB V KESIMPULAN DAN SARAN</strong></td><td style="text-align:right;"><br>30</td></tr>
            <tr><td style="padding-left:15pt;">5.1 Kesimpulan</td><td style="text-align:right;">30</td></tr>
            <tr><td style="padding-left:15pt;">5.2 Saran & Rekomendasi</td><td style="text-align:right;">32</td></tr>
            ` : ''}
            <tr><td><br><strong>DAFTAR PUSTAKA</strong></td><td style="text-align:right;"><br>34</td></tr>
          </table>
          ` : ''}

        </div>

        <!-- ========================================================= -->
        <!-- 3. ISI UTAMA NASKAH (BAB I s.d. BAB V / BAB III)          -->
        <!-- ========================================================= -->
        <div class="SectionMain">
          <div class="page-break"></div>
          ${renderDocumentBody(sections, isSkripsi, isProposal)}

          <div class="page-break"></div>
          <!-- DAFTAR PUSTAKA FORMAT APA 7th -->
          <h1 class="chapter-head">DAFTAR PUSTAKA</h1>
          ${formatBibliography(sections.daftarPustaka || sections.references)}
        </div>

      </body>
      </html>
    `;
  }

  function renderDocumentBody(sections, isSkripsi, isProposal) {
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
        ${formatParagraphs(sections.manfaat || sections.bab1_4 || 'Manfaat teoritis dan praktis bagi pengembangan ilmu dan institusi.')}

        <div class="page-break"></div>

        <!-- BAB II -->
        <h1 class="chapter-head">BAB II<br>TINJAUAN PUSTAKA</h1>
        <h2 class="section-head">2.1 Landasan Teori</h2>
        ${formatParagraphs(sections.landasanTeori || sections.bab2_1 || 'Landasan teoritis pendukung riset.')}

        <h2 class="section-head">2.2 Penelitian Terdahulu (State of the Art)</h2>
        ${formatParagraphs(sections.penelitianTerdahulu || sections.bab2_2 || 'Review komparatif literatur dan gap penelitian terdahulu.')}

        <h2 class="section-head">2.3 Kerangka Pemikiran & Hipotesis</h2>
        ${formatParagraphs(sections.kerangkaPemikiran || sections.bab2_3 || 'Alur pikir konseptual dan hubungan antar variabel.')}

        <div class="page-break"></div>

        <!-- BAB III -->
        <h1 class="chapter-head">BAB III<br>METODOLOGI PENELITIAN</h1>
        <h2 class="section-head">3.1 Desain Penelitian</h2>
        ${formatParagraphs(sections.desainPenelitian || sections.metodologi || sections.bab3_1 || 'Pendekatan dan desain metodologi penelitian.')}

        <h2 class="section-head">3.2 Sumber Data & Instrumen</h2>
        ${formatParagraphs(sections.sumberData || sections.bab3_2 || 'Populasi, sampel, dataset, dan instrumen pengumpulan data.')}

        <h2 class="section-head">3.3 Teknik Analisis Data</h2>
        ${formatParagraphs(sections.analisisData || sections.bab3_3 || 'Metode analisis kuantitatif, kualitatif, atau eksperimental.')}

        <div class="page-break"></div>

        <!-- BAB IV -->
        <h1 class="chapter-head">BAB IV<br>HASIL DAN PEMBAHASAN</h1>
        <h2 class="section-head">4.1 Hasil Analisis Empiris</h2>
        ${formatParagraphs(sections.hasil || sections.bab4_1 || sections.pembahasan || 'Temuan dan hasil pengujian empiris.')}

        <h2 class="section-head">4.2 Diskusi Akademik</h2>
        ${formatParagraphs(sections.diskusi || sections.bab4_2 || 'Sintesis hasil analisis dengan literatur dan penelitian terdahulu.')}

        <div class="page-break"></div>

        <!-- BAB V -->
        <h1 class="chapter-head">BAB V<br>KESIMPULAN DAN SARAN</h1>
        <h2 class="section-head">5.1 Kesimpulan</h2>
        ${formatParagraphs(sections.kesimpulan || sections.bab5_1 || 'Kesimpulan menyeluruh hasil penelitian.')}

        <h2 class="section-head">5.2 Saran & Rekomendasi</h2>
        ${formatParagraphs(sections.saran || sections.bab5_2 || 'Rekomendasi aplikatif dan agenda riset lanjutan.')}
      `;
    }

    // Proposal Skripsi (3 Bab: Bab I-III)
    if (isProposal) {
      return `
        <!-- BAB I -->
        <h1 class="chapter-head">BAB I<br>PENDAHULUAN</h1>
        <h2 class="section-head">1.1 Latar Belakang Masalah</h2>
        ${formatParagraphs(sections.latarBelakang || 'Latar belakang masalah memuat fenomena empiris dan kesenjangan riset.')}

        <h2 class="section-head">1.2 Rumusan Masalah</h2>
        ${formatParagraphs(sections.rumusanMasalah || 'Rumusan masalah usulan penelitian.')}

        <h2 class="section-head">1.3 Batasan Masalah</h2>
        ${formatParagraphs(sections.batasanMasalah || 'Ruang lingkup dan batasan objek penelitian.')}

        <h2 class="section-head">1.4 Tujuan Penelitian</h2>
        ${formatParagraphs(sections.tujuan || 'Tujuan umum dan khusus penelitian.')}

        <h2 class="section-head">1.5 Manfaat Penelitian</h2>
        ${formatParagraphs(sections.manfaat || 'Manfaat teoritis dan praktis.')}

        <div class="page-break"></div>

        <!-- BAB II -->
        <h1 class="chapter-head">BAB II<br>TINJAUAN PUSTAKA</h1>
        <h2 class="section-head">2.1 Landasan Teori</h2>
        ${formatParagraphs(sections.landasanTeori || 'Landasan teoritis pendukung usulan riset.')}

        <h2 class="section-head">2.2 Penelitian Terdahulu (State of the Art)</h2>
        ${formatParagraphs(sections.penelitianTerdahulu || 'Telaah literatur dan identifikasi novelty riset.')}

        <h2 class="section-head">2.3 Kerangka Konseptual</h2>
        ${formatParagraphs(sections.kerangkaPemikiran || 'Kerangka alur pikir usulan penelitian.')}

        <div class="page-break"></div>

        <!-- BAB III -->
        <h1 class="chapter-head">BAB III<br>METODE PENELITIAN</h1>
        <h2 class="section-head">3.1 Desain Penelitian</h2>
        ${formatParagraphs(sections.desainPenelitian || sections.metodologi || 'Rancangan metodologi yang diusulkan.')}

        <h2 class="section-head">3.2 Objek dan Sumber Data</h2>
        ${formatParagraphs(sections.sumberData || 'Dataset, instrumen, dan teknik pengumpulan data.')}

        <h2 class="section-head">3.3 Prosedur dan Jadwal Riset</h2>
        ${formatParagraphs(sections.analisisData || 'Tahapan pengujian dan estimasi jadwal penelitian.')}
      `;
    }

    // Makalah Ilmiah (3 Bab Standar)
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
      <h2 class="section-head">2.1 Landasan Teoretis</h2>
      ${formatParagraphs(sections.landasanTeori || 'Landasan teoretis belum terisi.')}

      <h2 class="section-head">2.2 Analisis dan Pembahasan Masalah</h2>
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
    
    // If text contains HTML tags like <p>, <div>, <h3>, <ol>, <ul>, return clean formatted HTML
    if (/<[a-z][\s\S]*>/i.test(text)) {
      return text
        .replace(/<p(\s[^>]*)?>/gi, '<p class="academic-paragraph">')
        .replace(/<li>/gi, '<li style="margin-bottom:4pt; line-height:inherit;">');
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
        const entry = typeof r === 'string' 
          ? r 
          : (r.bib || `${escapeXml(r.authors)} (${r.year || 2024}). ${escapeXml(r.title)}. <em>${escapeXml(r.journal || 'Jurnal Ilmiah')}</em>.`);
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
   * Triggers download of Microsoft Word compatible document (.docx / .doc)
   */
  function exportToDocx(meta, sections, options = {}) {
    try {
      const htmlContent = buildWordDocumentHtml(meta, sections, options);
      const safeTitle = (meta.title || 'Naskah_Skripsi_Thesa')
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 50);

      const blob = new Blob(['\ufeff', htmlContent], {
        type: 'application/msword;charset=utf-8'
      });

      const filename = `${safeTitle}.doc`;

      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.setAttribute('style', 'display:none');
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      console.error('[Thesa Export DOCX Error]', err);
      const htmlContent = buildWordDocumentHtml(meta, sections, options);
      const encoded = encodeURIComponent(htmlContent);
      const link = document.createElement('a');
      link.href = 'data:application/msword;charset=utf-8,\ufeff' + encoded;
      link.download = `${(meta.title || 'Naskah_Thesa').replace(/\s+/g, '_')}.doc`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) document.body.removeChild(link);
      }, 1000);
    }
  }

  /**
   * Opens Print / PDF export dialog with Indonesian Higher Education Academic Styling
   */
  function exportToPdf(meta, sections, options = {}) {
    const htmlContent = buildWordDocumentHtml(meta, sections, options);
    
    // Inject print toolbar & styling for perfect browser print dialog
    const printDocHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Pratinjau Cetak / PDF — ${escapeXml(meta.title || 'Naskah Skripsi Thesa')}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 4cm 3cm 3cm 4cm; /* Top 4cm, Right 3cm, Bottom 3cm, Left 4cm */
          }
          @media print {
            .no-print { display: none !important; }
            body { 
              margin: 0 !important; 
              padding: 0 !important; 
              font-family: 'Times New Roman', serif; 
              font-size: 12pt;
              color: #000;
              background: #fff;
            }
            .page-break { page-break-before: always; }
          }
          @media screen {
            body {
              background: #525659;
              margin: 0;
              padding: 0;
              font-family: 'Times New Roman', serif;
            }
            .print-bar {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              height: 54px;
              background: #1e293b;
              color: #fff;
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 0 24px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.3);
              z-index: 99999;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .paper-preview-container {
              max-width: 210mm;
              margin: 70px auto 40px auto;
              background: #fff;
              padding: 40mm 30mm 30mm 40mm;
              box-shadow: 0 4px 20px rgba(0,0,0,0.3);
              box-sizing: border-box;
              min-height: 297mm;
            }
            .btn-print {
              background: #2563eb;
              color: #fff;
              border: none;
              padding: 8px 18px;
              border-radius: 6px;
              font-weight: 600;
              cursor: pointer;
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .btn-print:hover { background: #1d4ed8; }
            .btn-close {
              background: rgba(255,255,255,0.12);
              color: #fff;
              border: 1px solid rgba(255,255,255,0.2);
              padding: 7px 14px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 13px;
            }
          }
        </style>
      </head>
      <body>
        <div class="print-bar no-print">
          <div style="font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px;">
            <span>📄 Format Cetak Standar DIKTI (Margin 4-4-3-3, Times New Roman 12)</span>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn-close" onclick="window.close()">Tutup Pratinjau</button>
            <button class="btn-print" onclick="window.print()">
              🖨️ Cetak / Simpan PDF
            </button>
          </div>
        </div>
        <div class="paper-preview-container">
          ${htmlContent}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=1000,height=900');
    if (!printWindow) {
      alert('⚠️ Silakan izinkan pop-up browser untuk membuka pratinjau cetak naskah PDF.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(printDocHtml);
    printWindow.document.close();

    printWindow.onload = function () {
      setTimeout(() => {
        printWindow.focus();
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
standard: "DIKTI Indonesia Academic Standard (4-4-3-3)"
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

### 1.4 Manfaat Penelitian
${sections.manfaat || sections.bab1_4 || '_Belum terisi_'}

---

## BAB II: TINJAUAN PUSTAKA

### 2.1 Landasan Teori
${sections.landasanTeori || sections.pembahasan || '_Belum terisi_'}

### 2.2 State of the Art & Gap Penelitian
${sections.penelitianTerdahulu || '_Belum terisi_'}

### 2.3 Kerangka Pemikiran
${sections.kerangkaPemikiran || '_Belum terisi_'}

---

## BAB III: METODOLOGI PENELITIAN

### 3.1 Desain Penelitian
${sections.desainPenelitian || sections.metodologi || '_Belum terisi_'}

### 3.2 Sumber Data & Pengumpulan
${sections.sumberData || '_Belum terisi_'}

### 3.3 Teknik Analisis Data
${sections.analisisData || '_Belum terisi_'}

---

## BAB IV: HASIL DAN PEMBAHASAN

### 4.1 Temuan Empiris
${sections.hasil || sections.pembahasan || '_Belum terisi_'}

### 4.2 Diskusi Akademik
${sections.diskusi || '_Belum terisi_'}

---

## BAB V: KESIMPULAN DAN SARAN

### 5.1 Kesimpulan
${sections.kesimpulan || '_Belum terisi_'}

### 5.2 Saran & Rekomendasi
${sections.saran || '_Belum terisi_'}

---

## DAFTAR PUSTAKA (APA 7th Edition)
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
    let bibContent = `% BibTeX Bibliography generated by Thesa AI Academic Engine\n% Standard: APA 7th / IEEE\n% Project: ${meta.title || 'Skripsi'}\n\n`;

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
