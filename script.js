// --- DISCARD SECURITY SYSTEM ---
// Todo el código está encapsulado para evitar acceso desde la consola (F12)
(function() {
    'use strict';

    // 1. CONGELAR DATOS ESTÁTICOS
    // Esto evita que modifiquen los costes o probabilidades en tiempo de ejecución
    if (typeof GAME_DATA !== 'undefined') {
        Object.freeze(GAME_DATA);
        Object.freeze(GAME_DATA.config);
        // Congelamos arrays internos superficialmente
        Object.freeze(GAME_DATA.cartas); 
    }

    // --- CONFIGURACIÓN PRIVADA ---
    const TIEMPO_COOLDOWN_QUIZ = 14400000; // 4 Horas
    const SECRET_SALT = "DisCard_Alpha_S3cur1ty_Key_99281"; // Clave para firmar el savegame

    // --- SISTEMA DE AUDIO ---
    const audioSystem = {
        bgm: new Audio('assets/sounds/music.mp3'),
        sfxRare: new Audio('assets/sounds/rare.mp3'),
        sfxEpic: new Audio('assets/sounds/epic.mp3'),
        sfxShake: new Audio('assets/sounds/shake.mp3'),
        sfxDraw: new Audio('assets/sounds/draw.mp3'),
        musicaActivada: false
    };

    audioSystem.bgm.loop = true;
    audioSystem.bgm.volume = 0.4;

    function playSoundCloned(audioElement) {
        const clone = audioElement.cloneNode();
        clone.volume = 0.6;
        clone.play().catch(e => {});
    }

    // --- ESTADO DEL JUGADOR (PRIVADO) ---
    let jugador = {
        creditos: GAME_DATA.config.monedaInicial,
        coleccion: [],
        conteoCartas: {}, 
        sobresSinEpica: 0,
        ultimoQuiz: 0,
        ultimoDaily: 0,
        codigosUsados: [],
        milestones: { comun: false, pocoComun: false, epica: false },
        stats: { packsOpened: 0, creditsSpent: 0, gambleCount: 0 }
    };

    // VARIABLES DE CONTROL
    let abriendoSobre = false; 
    let quizTimerInterval = null; 
    let gamblePendingAmount = 0; 

    // --- FUNCIONES DE SEGURIDAD (HASHING) ---
    
    // Genera un hash simple tipo DJB2 modificado para validar integridad
    function generarFirma(stringData) {
        let hash = 0, i, chr;
        const stringToSign = stringData + SECRET_SALT;
        if (stringToSign.length === 0) return hash;
        for (i = 0; i < stringToSign.length; i++) {
            chr = stringToSign.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0; // Convertir a 32bit integer
        }
        return hash.toString(16); // Retornar en Hex
    }

    // Codifica a Base64 Unicode-safe
    function b64EncodeUnicode(str) {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(match, p1) {
                return String.fromCharCode('0x' + p1);
        }));
    }

    // Decodifica Base64 Unicode-safe
    function b64DecodeUnicode(str) {
        return decodeURIComponent(atob(str).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    }

    // --- INICIALIZACIÓN ---
    window.onload = function() {
        // Migración de datos iniciales si es necesario
        if (!jugador.stats) jugador.stats = { packsOpened: 0, creditsSpent: 0, gambleCount: 0 };
        if (!jugador.conteoCartas) {
            jugador.conteoCartas = {};
            jugador.coleccion.forEach(id => { jugador.conteoCartas[id] = 1; });
        }
        
        actualizarUI();
        aplicarFiltros(); 
        setInterval(actualizarEstadoBotonQuiz, 1000);
        
        // Bloquear clic derecho (opcional, disuasorio básico)
        // document.addEventListener('contextmenu', event => event.preventDefault());
    };

    // --- LÓGICA DEL JUEGO ---

    function toggleMusica() {
        const btn = document.getElementById('btn-music');
        if (audioSystem.musicaActivada) {
            audioSystem.bgm.pause();
            audioSystem.musicaActivada = false;
            btn.innerText = "🔇 Música: OFF";
            btn.classList.remove('active');
        } else {
            audioSystem.bgm.play().catch(e => console.log("Error audio:", e));
            audioSystem.musicaActivada = true;
            btn.innerText = "🔊 Música: ON";
            btn.classList.add('active');
        }
    }

    function aplicarFiltros() {
        const texto = document.getElementById('search-input').value.toLowerCase();
        const rareza = document.getElementById('rarity-filter').value;
        renderizarAlbum(texto, rareza);
    }

    function creatingCartaVisual(d, m) {
        let div = document.createElement('div');
        div.className = `card ${d.rareza.replace(" ", "_")}`;
        div.setAttribute("data-tilt", "");
        div.setAttribute("data-tilt-glare", "");
        div.setAttribute("data-tilt-max-glare", "0.4");
        div.setAttribute("data-tilt-scale", m ? "1.0" : "1.05");

        div.innerHTML = `
            <div class="card-border"></div>
            <div class="holo-overlay"></div>
            <div class="card-inner-mask">
                <img src="${d.img}" onerror="this.src='https://via.placeholder.com/180x270?text=?'">
            </div>
            <div class="fantasy-ribbon">
                <span>${d.nombre}</span>
            </div>
        `;

        if (typeof VanillaTilt !== 'undefined') VanillaTilt.init(div);
        return div;
    }

    function abrirModal(cartaData) {
        const modal = document.getElementById('card-modal');
        const container = document.getElementById('modal-card-container');
        container.innerHTML = '';
        
        let cartaGrande = creatingCartaVisual(cartaData, true);
        cartaGrande.style.width = "400px";
        cartaGrande.style.height = "600px";
        cartaGrande.style.cursor = "default";
        container.appendChild(cartaGrande);

        let descBox = document.createElement('div');
        descBox.className = "zoom-description-box";
        descBox.innerHTML = `<h3>${cartaData.nombre}</h3><p>"${cartaData.desc}"</p>`;
        container.appendChild(descBox);

        modal.style.display = "flex";
        setTimeout(() => { modal.classList.add('show'); }, 10);
    }

    // --- SISTEMA DE APERTURA ---

    function iniciarApertura() {
        if (abriendoSobre) return; // Anti-spam click
        if (jugador.creditos < GAME_DATA.config.costoSobre) {
            if (confirm("¡Sin créditos! ¿Misión Técnica?")) abrirQuiz();
            return;
        }
        
        jugador.creditos -= GAME_DATA.config.costoSobre;
        jugador.stats.creditsSpent += GAME_DATA.config.costoSobre;
        jugador.stats.packsOpened++;

        actualizarUI();

        const o = document.getElementById('pack-overlay');
        const p = document.getElementById('pack-visual');
        const oc = document.getElementById('opened-cards');
        const b = document.getElementById('btn-close-pack');
        const m = document.getElementById('pack-msg');

        o.style.display = 'flex';
        p.style.display = 'flex';
        p.style.opacity = '1';
        p.classList.remove('shake');
        m.style.display = 'block';
        oc.innerHTML = '';
        oc.classList.remove('visible');
        b.style.display = 'none';
        
        abriendoSobre = false;
    }

    function abrirSobre() {
        if (abriendoSobre) return; 
        abriendoSobre = true;      

        const p = document.getElementById('pack-visual');
        const m = document.getElementById('pack-msg');

        audioSystem.sfxShake.currentTime = 0;
        audioSystem.sfxShake.play().catch(e => {});

        p.classList.add('shake');

        setTimeout(() => {
            crearExplosionConfeti();
            p.style.opacity = '0';
            m.style.display = 'none';

            setTimeout(() => {
                p.style.display = 'none';
                p.classList.remove('shake');
                generarCartasSobre();
            }, 200);

        }, 600);
    }

    function generarCartasSobre() {
        const c = document.getElementById('opened-cards');
        const qc = GAME_DATA.config.cartasPorSobre || 3; 
        if (typeof jugador.sobresSinEpica === 'undefined') jugador.sobresSinEpica = 0;
        
        let hse = false;
        let rme = 0; 

        for (let i = 0; i < qc; i++) {
            let r = "Comun";
            let rnd = Math.random() * 100;
            // Pity Timer Logic
            if (i === (qc - 1) && jugador.sobresSinEpica >= 25 && !hse) {
                r = "Epica";
            } else {
                if (rnd <= 3) r = "Epica";
                else if (rnd <= 18) r = "Poco Comun";
            }

            if (r === "Epica") { hse = true; rme = 2; }
            else if (r === "Poco Comun") { if (rme < 1) rme = 1; }

            let pool = GAME_DATA.cartas.filter(c => c.rareza === r);
            if (pool.length === 0) pool = GAME_DATA.cartas; 
            
            let co = pool[Math.floor(Math.random() * pool.length)];

            // Registro histórico seguro
            if (!jugador.conteoCartas) jugador.conteoCartas = {};
            jugador.conteoCartas[co.id] = (jugador.conteoCartas[co.id] || 0) + 1;

            let ch = creatingCartaVisual(co, false);

            if (jugador.coleccion.includes(co.id)) {
                let v = (r === "Epica") ? 100 : (r === "Poco Comun" ? 20 : 5);
                jugador.creditos += v;
                let t = document.createElement('div');
                t.innerText = `REPETIDA (+${v})`;
                t.style.cssText = "position:absolute; top:50%; width:100%; background:rgba(200,0,0,0.9); color:white; text-align:center; padding:5px; z-index:10; font-weight:bold; transform: rotate(-15deg); box-shadow: 0 5px 10px black;";
                ch.appendChild(t);
            } else {
                jugador.coleccion.push(co.id);
            }

            ch.style.opacity = '0';
            ch.style.transform = 'translateY(50px)';
            c.appendChild(ch);

            setTimeout(() => {
                playSoundCloned(audioSystem.sfxDraw);
                ch.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                ch.style.opacity = '1';
                ch.style.transform = 'translateY(0)';
            }, i * 150);
        }

        setTimeout(() => {
            if (rme === 2) { audioSystem.sfxEpic.currentTime = 0; audioSystem.sfxEpic.play().catch(e => {}); } 
            else if (rme === 1) { audioSystem.sfxRare.currentTime = 0; audioSystem.sfxRare.play().catch(e => {}); }
        }, 400);

        if (hse) jugador.sobresSinEpica = 0;
        else jugador.sobresSinEpica++;

        c.classList.add('visible');
        abriendoSobre = false; 

        setTimeout(() => {
            document.getElementById('btn-close-pack').style.display = 'block';
        }, 1000);
        
        actualizarUI();
    }

    function cerrarSobre() {
        document.getElementById('pack-overlay').style.display = 'none';
        aplicarFiltros(); 
        verificarMilestones();
    }

    // --- MILESTONES ---
    function verificarMilestones() {
        const coleccionUnica = new Set(jugador.coleccion);
        let tc = 0, cc = 0, tpc = 0, cpc = 0, te = 0, ce = 0;

        GAME_DATA.cartas.forEach(c => {
            if (c.rareza === "Comun") { tc++; if (coleccionUnica.has(c.id)) cc++; }
            else if (c.rareza === "Poco Comun") { tpc++; if (coleccionUnica.has(c.id)) cpc++; }
            else if (c.rareza === "Epica") { te++; if (coleccionUnica.has(c.id)) ce++; }
        });

        if (ce === te && te > 0 && !jugador.milestones.epica) {
            jugador.milestones.epica = true;
            mostrarVideoMilestone("assets/videos/epic_complete.mp4", "¡COLECCIÓN ÉPICA COMPLETADA!");
        } else if (cpc === tpc && tpc > 0 && !jugador.milestones.pocoComun) {
            jugador.milestones.pocoComun = true;
            mostrarVideoMilestone("assets/videos/uncommon_complete.mp4", "¡COLECCIÓN POCO COMÚN COMPLETADA!");
        } else if (cc === tc && tc > 0 && !jugador.milestones.comun) {
            jugador.milestones.comun = true;
            mostrarVideoMilestone("assets/videos/comun_complete.mp4", "¡COLECCIÓN COMÚN COMPLETADA!");
        }
    }

    function mostrarVideoMilestone(v, t) {
        const o = document.getElementById('video-overlay');
        const el = document.getElementById('milestone-video');
        const ti = document.getElementById('video-title');
        if (audioSystem.musicaActivada) audioSystem.bgm.pause();
        ti.innerText = t;
        el.src = v;
        el.onended = function() { cerrarVideoMilestone(); };
        o.style.display = "flex";
        setTimeout(() => {
            o.classList.add('show');
            el.play().catch(e => {});
        }, 50);
    }

    function cerrarVideoMilestone() {
        const o = document.getElementById('video-overlay');
        const el = document.getElementById('milestone-video');
        el.pause(); el.currentTime = 0;
        o.classList.remove('show');
        setTimeout(() => {
            o.style.display = "none";
            el.onended = null;
            if (audioSystem.musicaActivada) audioSystem.bgm.play().catch(e => {});
            guardarPartidaManual();
        }, 500);
    }

    // --- GUARDADO Y CARGA SEGUROS ---

    function guardarPartidaManual() {
        // 1. Convertir JSON a String
        const jsonString = JSON.stringify(jugador);
        // 2. Ofuscar con Base64
        const payload = b64EncodeUnicode(jsonString);
        // 3. Generar Firma Digital
        const signature = generarFirma(payload);

        // Creamos el objeto contenedor seguro
        const secureSave = {
            v: 1,
            payload: payload,
            signature: signature
        };

        const b = new Blob([JSON.stringify(secureSave)], { type: "application/json" });
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = u;
        a.download = "DiscardSavegame.json"; // Cambiado nombre por claridad
        a.click();
    }

    function cargarPartida(i) {
        const f = i.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(e) {
            try {
                const archivo = JSON.parse(e.target.result);

                // --- VERIFICACIÓN DE SEGURIDAD ---
                // Chequear si es un save antiguo (sin firma) o nuevo (con firma)
                if (archivo.payload && archivo.signature) {
                    const checkSignature = generarFirma(archivo.payload);
                    if (checkSignature !== archivo.signature) {
                        alert("⚠️ ERROR DE INTEGRIDAD ⚠️\nEl archivo ha sido modificado externamente y es inválido.");
                        return;
                    }
                    // Si la firma es correcta, decodificamos
                    const decodedJson = b64DecodeUnicode(archivo.payload);
                    const d = JSON.parse(decodedJson);
                    
                    // Sanity Checks (evitar valores corruptos o hackeados extremos)
                    if (d.creditos < 0 || isNaN(d.creditos)) d.creditos = 0;
                    
                    mergeDatosJugador(d);
                    alert("¡Partida cargada y verificada correctamente! ✅");

                } else {
                    // Soporte Legacy (archivos antiguos sin seguridad)
                    // Podrías bloquear esto si quieres forzar solo saves nuevos
                    if(confirm("Este archivo es de una versión antigua (Insegura). ¿Cargar de todos modos?")) {
                        mergeDatosJugador(archivo);
                    }
                }
            } catch (err) {
                console.error(err);
                alert("❌ Archivo corrupto o ilegible.");
            }
        };
        r.readAsText(f);
        // Limpiar input para permitir recargar el mismo archivo
        i.value = ''; 
    }

    function mergeDatosJugador(d) {
        jugador = { ...jugador, ...d };
        // Asegurar estructura
        if (!jugador.milestones) jugador.milestones = { comun: false, pocoComun: false, epica: false };
        if (!jugador.stats) jugador.stats = { packsOpened: 0, creditsSpent: 0, gambleCount: 0 };
        if (!jugador.conteoCartas) {
            jugador.conteoCartas = {};
            jugador.coleccion.forEach(id => { jugador.conteoCartas[id] = 1; });
        }
        actualizarUI();
        aplicarFiltros();
    }

    // --- UTILIDADES DE UI ---

    function cerrarModal(e) {
        if (e.target.id === 'card-modal' || e.target.classList.contains('close-btn')) {
            const m = document.getElementById('card-modal');
            m.classList.remove('show');
            setTimeout(() => {
                m.style.display = "none";
                document.getElementById('modal-card-container').innerHTML = '';
            }, 300);
        }
    }

    function crearExplosionConfeti() {
        const c = document.getElementById('particles-container');
        const colors = ['#f00', '#0f0', '#00f', '#ff0', '#f0f', '#fff', '#ffd700'];
        for (let i = 0; i < 50; i++) {
            const p = document.createElement('div');
            p.classList.add('particle');
            p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            const a = Math.random() * Math.PI * 2;
            const v = 100 + Math.random() * 200;
            const tx = Math.cos(a) * v;
            const ty = Math.sin(a) * v;
            p.animate([
                { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0)`, opacity: 0 }
            ], { duration: 800 + Math.random() * 400, easing: 'cubic-bezier(0,.9,.57,1)' });
            c.appendChild(p);
            setTimeout(() => p.remove(), 1200);
        }
    }

    function renderizarAlbum(filtroTexto = "", filtroRareza = "all") {
        const a = document.getElementById('album');
        a.innerHTML = '';
        const cc = jugador.coleccion;

        GAME_DATA.cartas.forEach(cd => {
            let coincideTexto = cd.nombre.toLowerCase().includes(filtroTexto);
            let coincideRareza = (filtroRareza === "all") || (cd.rareza.replace(" ", "") === filtroRareza.replace(" ", ""));

            if (coincideTexto && coincideRareza) {
                if (cc.includes(cd.id)) {
                    let ch = creatingCartaVisual(cd, false);
                    ch.onclick = function() { abrirModal(cd); };
                    a.appendChild(ch);
                } else {
                    let ld = document.createElement('div');
                    ld.className = 'card locked';
                    ld.classList.add(cd.rareza.replace(" ", "_"));
                    a.appendChild(ld);
                }
            }
        });

        const u = new Set(cc).size;
        document.getElementById('count-display').innerText = `${u}/${GAME_DATA.cartas.length}`;
    }

    function actualizarUI() {
        document.getElementById('credits-display').innerText = `CR: ${jugador.creditos}`;
    }

    // --- CÓDIGOS Y DOBLE O NADA ---

    function canjearCodigo() {
        const i = document.getElementById('input-code');
        const c = i.value.trim().toUpperCase();
        if (!c) return;
        
        if (GAME_DATA.codigos.hasOwnProperty(c)) {
            if (!jugador.codigosUsados) jugador.codigosUsados = [];
            if (jugador.codigosUsados.includes(c)) {
                alert("❌ ¡Código ya usado!");
                i.value = '';
                return;
            }
            
            const premio = GAME_DATA.codigos[c];
            jugador.codigosUsados.push(c);
            abrirDobleONada(premio);
            i.value = '';
        } else {
            alert("⚠️ Código inválido.");
        }
    }

    function abrirDobleONada(cantidad) {
        gamblePendingAmount = cantidad;
        const m = document.getElementById('coin-modal');
        document.getElementById('gamble-amount').innerText = cantidad;
        document.getElementById('coin-controls').style.display = 'flex';
        document.getElementById('coin-result').innerHTML = '';
        document.getElementById('coin-visual').style.transform = 'rotateY(0deg)'; 
        m.style.display = 'flex';
    }

    function retirarseDoble() {
        jugador.creditos += gamblePendingAmount;
        alert(`Has reclamado ${gamblePendingAmount} CR.`);
        actualizarUI();
        document.getElementById('coin-modal').style.display = 'none';
    }

    function jugarDoble() {
        const controls = document.getElementById('coin-controls');
        const coin = document.getElementById('coin-visual');
        const resultDiv = document.getElementById('coin-result');
        
        controls.style.display = 'none'; 
        jugador.stats.gambleCount = (jugador.stats.gambleCount || 0) + 1;

        let rotacion = 1800 + (Math.random() * 3600); 
        const win = Math.random() > 0.5;
        
        if (!win) rotacion += 180; 

        coin.style.transition = "transform 3s cubic-bezier(0.1, 0.7, 0.1, 1)";
        coin.style.transform = `rotateY(${rotacion}deg)`;

        if(audioSystem.sfxShake) playSoundCloned(audioSystem.sfxShake);

        setTimeout(() => {
            if (win) {
                const total = gamblePendingAmount * 2;
                jugador.creditos += total;
                resultDiv.innerHTML = `<h3 style="color:#00ffaa; margin:0;">¡VICTORIA! GANAS ${total} CR</h3>`;
                if(audioSystem.sfxEpic) audioSystem.sfxEpic.play().catch(e=>{});
            } else {
                resultDiv.innerHTML = `<h3 style="color:#ff4444; margin:0;">PERDISTE... TE QUEDAS CON 0.</h3>`;
            }
            actualizarUI();
            
            setTimeout(() => {
                resultDiv.innerHTML += `<br><button class="btn" style="margin-top:10px;" onclick="document.getElementById('coin-modal').style.display='none'">Cerrar</button>`;
            }, 500);

        }, 3000);
    }

    // --- QUIZ ---

    function abrirQuiz() {
        if (abriendoSobre) return;
        const a = Date.now();
        const tp = a - (jugador.ultimoQuiz || 0);
        if (tp < TIEMPO_COOLDOWN_QUIZ) {
            alert("Todavía en enfriamiento.");
            return;
        }

        const m = document.getElementById('quiz-modal');
        const qt = document.getElementById('quiz-question-text');
        const oc = document.getElementById('quiz-options-container');
        const f = document.getElementById('quiz-feedback');
        const b = document.getElementById('btn-close-quiz');
        const timerBar = document.getElementById('quiz-timer-bar');

        m.style.display = 'flex';
        oc.innerHTML = '';
        f.innerText = '';
        b.style.display = 'none';

        const ri = Math.floor(Math.random() * GAME_DATA.quiz.length);
        const pd = GAME_DATA.quiz[ri];
        const rc = pd.r[0]; 
        let om = [...pd.r];
        for (let i = om.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [om[i], om[j]] = [om[j], om[i]];
        }

        qt.innerText = pd.p;

        om.forEach(o => {
            let btn = document.createElement('button');
            btn.className = 'btn-option';
            btn.innerText = o;
            btn.onclick = () => verificarRespuesta(btn, o, rc);
            oc.appendChild(btn);
        });

        timerBar.style.width = '100%';
        timerBar.style.background = '#00ffaa';
        let timeLeft = 6000; 
        
        if(quizTimerInterval) clearInterval(quizTimerInterval);
        
        quizTimerInterval = setInterval(() => {
            timeLeft -= 50;
            let pct = (timeLeft / 6000) * 100;
            timerBar.style.width = `${pct}%`;

            if (pct < 30) timerBar.style.background = '#ff0000';

            if (timeLeft <= 0) {
                clearInterval(quizTimerInterval);
                finalizarQuiz(false, null, rc, true); 
            }
        }, 50);
    }

    function verificarRespuesta(btn, seleccion, correcta) {
        clearInterval(quizTimerInterval);
        if (seleccion === correcta) {
            finalizarQuiz(true, btn, correcta);
        } else {
            finalizarQuiz(false, btn, correcta);
        }
    }

    function finalizarQuiz(ganado, btn, correcta, porTiempo = false) {
        const f = document.getElementById('quiz-feedback');
        const bc = document.getElementById('btn-close-quiz');
        const ops = document.querySelectorAll('.btn-option');
        ops.forEach(o => o.disabled = true);
        
        jugador.ultimoQuiz = Date.now();

        if (ganado) {
            btn.classList.add('correct-anim');
            let p = 100;
            jugador.creditos += p;
            f.innerHTML = `¡CORRECTO! <strong>+${p} CR</strong>`;
            f.style.color = '#28a745';
        } else {
            if (!porTiempo && btn) btn.classList.add('wrong-anim');
            f.innerText = porTiempo ? "¡TIEMPO AGOTADO!" : "INCORRECTO.";
            f.style.color = '#dc3545';
        }

        actualizarUI();
        actualizarEstadoBotonQuiz();
        bc.style.display = 'inline-block';
    }

    function actualizarEstadoBotonQuiz() {
        const b = document.querySelector('.btn-quiz');
        if (!b) return;
        const a = Date.now();
        const t = a - (jugador.ultimoQuiz || 0);
        
        if (t < TIEMPO_COOLDOWN_QUIZ) {
            const restante = TIEMPO_COOLDOWN_QUIZ - t;
            const horas = Math.floor(restante / (1000 * 60 * 60));
            const minutos = Math.floor((restante % (1000 * 60 * 60)) / (1000 * 60));
            const segundos = Math.floor((restante % (1000 * 60)) / 1000);
            
            if (horas > 0) b.innerText = `⏳ (${horas}h ${minutos}m)`;
            else b.innerText = `⏳ (${minutos}m ${segundos}s)`;
            
            b.style.opacity = "0.6";
            b.style.cursor = "not-allowed";
        } else {
            b.innerText = "🧠 Misión Técnica (+100 CR)";
            b.style.opacity = "1";
            b.style.cursor = "pointer";
        }
    }

    function cerrarQuiz() {
        clearInterval(quizTimerInterval);
        document.getElementById('quiz-modal').style.display = 'none';
    }

    function toggleStats() {
        const p = document.getElementById('stats-panel');
        const isOpen = p.classList.contains('open');
        if (!isOpen) {
            calcularEstadisticas();
            p.classList.add('open');
        } else {
            p.classList.remove('open');
        }
    }

    function calcularEstadisticas() {
        document.getElementById('stat-packs').innerText = jugador.stats ? jugador.stats.packsOpened : 0;
        document.getElementById('stat-spent').innerText = jugador.stats ? jugador.stats.creditsSpent : 0;
        document.getElementById('stat-gambles').innerText = jugador.stats ? jugador.stats.gambleCount : 0;
        
        const counts = jugador.conteoCartas || {};
        let maxCount = 0;
        let maxId = null;

        for (const [id, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                maxId = id;
            }
        }

        if (maxId) {
            const carta = GAME_DATA.cartas.find(c => c.id === maxId);
            document.getElementById('stat-fav-card').innerText = `${carta.nombre} (x${maxCount})`;
        } else {
            document.getElementById('stat-fav-card').innerText = "Ninguna";
        }
    }

    // --- EXPOSICIÓN CONTROLADA (PUBLIC API) ---
    // Como todo está privado, necesitamos exponer las funciones que usa el HTML (onclick)
    window.toggleStats = toggleStats;
    window.toggleMusica = toggleMusica;
    window.guardarPartidaManual = guardarPartidaManual;
    window.cargarPartida = cargarPartida;
    window.canjearCodigo = canjearCodigo;
    window.iniciarApertura = iniciarApertura;
    window.abrirQuiz = abrirQuiz;
    window.aplicarFiltros = aplicarFiltros;
    window.abrirSobre = abrirSobre;
    window.cerrarSobre = cerrarSobre;
    window.cerrarModal = cerrarModal;
    window.cerrarQuiz = cerrarQuiz;
    window.jugarDoble = jugarDoble;
    window.retirarseDoble = retirarseDoble;
    window.cerrarVideoMilestone = cerrarVideoMilestone;

})(); // FIN DEL IIFE