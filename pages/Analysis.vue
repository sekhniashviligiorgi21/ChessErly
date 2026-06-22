<script setup>
	import { ref, computed, onMounted } from 'vue'
	import { Chess } from 'chess.js'
	import { TheChessboard } from 'vue3-chessboard'
	import 'vue3-chessboard/style.css'
	import Title from "../assets/Title.vue"
	import { startEngine, getEvaluation, cancelAnalysis } from "../engine/engine.js"


	onMounted(async() => {
	  await startEngine();
	});

	const chess = new Chess()
	const greedyChess = new Chess()
	const excellentChess = new Chess()
	const bestChess = new Chess()
	const moveData = ref(null)
	const boardAPI = ref(null)
	const isAnalyzing = ref(false)
	const currentDepth = ref(10)
	const height = ref(47.75)
	const cp = ref(0)
	const rotate = ref(0)
	const isAccuracy = ref("")
	const color = ref("")
	const sanLine = ref([])
	const bestMoveSan = ref('')
	const excellentSanLine = ref([])
	const treeVersion = ref(0)
	const movesListUCI = ref([])

	const moveTree = {
		id: 0,
		san: null,
		uci: null,
		fen: chess.fen(),
		accuracy: null,
		parent: null,
		children: []
	}

	let nodeIdCounter = 1
	const nodeMap = { 0: moveTree }
	const currentNode = ref(moveTree)

	

	    const renderedMoves = computed(() => {
        treeVersion.value
        const rows = []

        function makeCell(node, moveNum, showAsStart, depth) {
            const isWhite = moveNum % 2 === 1
            return {
                key: `cell-${node.id}-${moveNum}-${depth}`,
                node,
                displayNum: Math.ceil(moveNum / 2),
                isWhite,
                showNum: isWhite || showAsStart,
                variant: depth > 0
            }
        }

        // Updated to accept startNode instead of strictly a child node
        function walk(startNode, moveNum, depth = 0, isStartOfLine = true) {
            let current = startNode
            let ply = moveNum
            let firstRow = true

            // If we are at the root (no SAN), we don't render a cell for it, 
            // we just use it to process its children as starting points.
            if (!current.san) {
                // If root has no children, nothing to render
                if (current.children.length === 0) return
                
                // Render the first child as a new line
                walk(current.children[0], ply, depth, isStartOfLine)
                
                // Render any remaining children as variations
                for (const variant of current.children.slice(1)) {
                    walk(variant, ply, depth + 1, true)
                }
                return
            }

            while (current) {
                const mainReply = current.children[0] ?? null

                rows.push({
                    key: `row-${current.id}-${ply}-${depth}-${rows.length}`,
                    depth,
                    cells: [
                        makeCell(current, ply, firstRow && isStartOfLine, depth),
                        mainReply ? makeCell(mainReply, ply + 1, false, depth) : null
                    ]
                })

                for (const variant of current.children.slice(1)) {
                    walk(variant, ply + 1, depth + 1, true)
                }

                if (mainReply) {
                    for (const variant of mainReply.children.slice(1)) {
                        walk(variant, ply + 2, depth + 1, true)
                    }
                }

                if (!mainReply) break
                current = mainReply.children[0] ?? null
                ply += 2
                firstRow = false
            }
        }

        // Start the walk from the moveTree root instead of just the first child
        walk(moveTree, 1)

        return rows
    })

	async function onBoardCreated(api) {
		boardAPI.value = api
		chess.reset()
		boardAPI.value.setPosition(chess.fen())
	}

	async function handleBothMoves(move) {
		const uci = move.promotion
			? `${move.from}${move.to}${move.promotion}`
			: `${move.from}${move.to}`

		const sanMove = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? undefined })
		if (!sanMove) {
			boardAPI.value.setPosition(currentNode.value.fen)
			return
		}

		const existing = currentNode.value.children.find(c => c.uci === uci)

		if (existing) {
			currentNode.value = existing
		} else {
			const newNode = {
				id: nodeIdCounter++,
				san: sanMove.san,
				uci,
				fen: chess.fen(),
				accuracy: null,
				parent: currentNode.value,
				children: []
			}
			nodeMap[newNode.id] = newNode
			currentNode.value.children.push(newNode)
			currentNode.value = newNode
		}

		movesListUCI.value.push(uci)
		treeVersion.value++
		await getAccuracy()
	}

	function undoMove() {
		if (currentNode.value.parent === null) return
		chess.undo()
		currentNode.value = currentNode.value.parent
		movesListUCI.value.pop()
		boardAPI.value.setPosition(chess.fen())
		treeVersion.value++
	}

	function redoMove() {
		if (currentNode.value.children.length === 0) return
		const nextNode = currentNode.value.children[0]
		chess.move(nextNode.uci, { sloppy: true })
		movesListUCI.value.push(nextNode.uci)
		currentNode.value = nextNode
		boardAPI.value.setPosition(nextNode.fen)
		treeVersion.value++
	}

	function undoAccuracy() {
		undoMove()
		if (movesListUCI.value.length > 0) {
			getAccuracy()
		} else {
			moveData.value = null
			isAccuracy.value = ""
			color.value = ""
		}
	}

	function redoAccuracy() {
		redoMove()
		if (movesListUCI.value.length > 0) getAccuracy()
	}

	function jumpToNode(nodeId) {
		const node = nodeMap[nodeId]
		if (!node || node === moveTree) return

		const uciMoves = []
		let current = node
		while (current.parent !== null) {
			uciMoves.unshift(current.uci)
			current = current.parent
		}

		chess.reset()
		for (const uci of uciMoves) {
			chess.move(uci, { sloppy: true })
		}

		movesListUCI.value = uciMoves
		currentNode.value = node
		boardAPI.value.setPosition(node.fen)
		moveData.value = null
		isAccuracy.value = ""
		color.value = ""
		treeVersion.value++
	}

	function resetBoard() {
		chess.reset()
		boardAPI.value.setPosition(chess.fen())
		movesListUCI.value = []
		currentNode.value = moveTree
		moveTree.children = []
		moveTree.fen = chess.fen()
		nodeIdCounter = 1
		for (const key in nodeMap) {
			if (parseInt(key) !== 0) delete nodeMap[key]
		}
		treeVersion.value++
	}

	function resetAccuracy() {
		resetBoard()
		isAccuracy.value = ""
		color.value = ""
		moveData.value = null
	}

	async function getAccuracy() {
		await cancelAnalysis()
		
	    isAnalyzing.value = true
	    isAccuracy.value = "Analyzing..."
	    color.value = "#aaa"
	 
	    await getEvaluation(
	        movesListUCI.value.at(-1),
	        movesListUCI.value.slice(0, -1),
	        30,
	        (result) => {
	            moveData.value = result
	            currentNode.value.accuracy = result.move_accuracy
	            currentDepth.value = result.depth
	            isAnalyzing.value = false
	            evalSize()
	            moveDescription()
	            sanBest()
	            uciSecondLine()
	            uciLine()
	            treeVersion.value++
	         }
	     )
	 }

	function formatEval(evalObj) {
		if (!evalObj) return ""
		if (evalObj.type === "cp") return (evalObj.value / 100).toFixed(2)
		if (evalObj.type === "mate") return `#${evalObj.value}`
	}

	function evalSize() {
		const evalValue = moveData.value.eval.value
		const evalType = moveData.value.eval.type
		if (evalType === "mate") {
			if (evalValue > 0) { cp.value = 800; height.value = 0 }
			else { cp.value = -800; height.value = 95.5 }
			return
		}
		cp.value = Math.max(-800, Math.min(800, evalValue))
		height.value = 47.75 - (cp.value / 1000) * 47.75
	}

	function flipBoard() {
		boardAPI.value.toggleOrientation()
		rotate.value += 180
	}

	function accuracySymbol(acc) {
		if (acc === "brilliant") return '!!'
		if (acc === "best") return "★"
		if (acc === "excellent") return '+'
		if (acc === "good") return '✔'
		if (acc === "inaccuracy") return '?!'
		if (acc === "mistake") return '?'
		if (acc === "blunder") return '??'
		if (acc === "great") return '!'
		if (acc === "book") return '📖'
	}

	function moveDescription() {
		isAccuracy.value = ''
		if (!currentNode.value.san) return
		const descriptions = {
			great:      { color: 'darkcyan',  text: 'is a great move!' },
			brilliant:  { color: 'lightblue', text: 'is a brilliant move!!' },
			book:       { color: '#AA8B6C',   text: 'is a book move' },
			best:       { color: '#3fa34d',   text: 'is the best move' },
			excellent:  { color: '#88B65C',   text: 'is an excellent move' },
			good:       { color: 'darkgreen', text: 'is a good move' },
			inaccuracy: { color: '#f0c36d',   text: 'is an inaccuracy' },
			mistake:    { color: '#e67e22',   text: 'is a mistake' },
			blunder:    { color: '#e74c3c',   text: 'is a blunder' },
		}
		const config = descriptions[moveData.value.move_accuracy]
		if (!config) return
		color.value = config.color
		isAccuracy.value = `${currentNode.value.san} ${config.text}`
	}

	function displayBest() {
		if (['brilliant', 'best', 'great', 'book', 'excellent'].includes(moveData.value.move_accuracy)) return ""
		if (moveData.value.best_move === "") return ""
		return bestMoveSan.value + " was the best"
	}

	function uciLine() {
		sanLine.value = []
		let lineNum = 0
		greedyChess.load(chess.fen())
		for (let i = 0; i < 30; i++) {
			const greedyMoveBefore = moveData.value.best_line[lineNum]
			if (!greedyMoveBefore) break
			const greedyMove = greedyChess.move(greedyMoveBefore, { sloppy: true })
			if (!greedyMove) break
			sanLine.value.push(greedyMove.san)
			lineNum++
		}
	}

	function sanBest() {
		bestChess.reset()
		for (const move of moveData.value.moves_list.slice(0, -1)) {
			bestChess.move(move)
		}
		const bestMoveBefore = moveData.value.best_move
		const bestMove = bestChess.move(bestMoveBefore, { sloppy: true })
		bestMoveSan.value = bestMove.san
	}

	function uciSecondLine() {
		excellentSanLine.value = []
		let secondLineNum = 0
		excellentChess.load(chess.fen())
		for (let i = 0; i < 30; i++) {
			const excellentMoveBefore = moveData.value.excellent_line[secondLineNum]
			if (!excellentMoveBefore) break
			const excellentMove = excellentChess.move(excellentMoveBefore, { sloppy: true })
			if (!excellentMove) break
			excellentSanLine.value.push(excellentMove.san)
			secondLineNum++
		}
	}

	function prettyLine(moves) {
		const pieces = { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
		return moves.map(m => m.replace(/[KQRBN]/g, p => pieces[p])).join(' ')
	}
</script>

<template>
	<div class="grid-layout">
		<Title/>
		<div class="board-area">
			<div class="chessboard">
				<TheChessboard @move="handleBothMoves" @board-created="onBoardCreated" :board-config="{coordinates: true}" />
				<div class="boardtools">
					<button class="reverse" @click="flipBoard">↳↰</button>
					<p class="reversetip">Flip Board</p>
					<button class="undo" @click="undoAccuracy" :disabled="currentNode.parent === null">↶</button>
					<p class="undotip">Previous Move</p>
					<button class="redo" @click="redoAccuracy" :disabled="currentNode.children.length === 0">↷</button>
					<p class="redotip">Next Move</p>
					<button class="reset" @click="resetAccuracy">🗘</button>
					<p class="resettip">Reset board</p>
				</div>
			</div>
			<div class="evalbar" :style="{rotate: rotate + 'deg'}">
				<div class="blackeval" :style="{ height: height + '%' }"></div>
				<p class="evalnum" :style="{rotate: rotate + 'deg'}">{{ formatEval(moveData?.eval) }}</p>
				<div class="whiteeval" :style="{ height: 95.5-height + '%' }"></div>
			</div>
		</div>
		<div>
			<div class="analyze">
				<h2 class="analyzis">Analysis</h2>
				<div v-if="moveData" class="move-data">
					<p class="depthnum">depth: {{ currentDepth }}</p>
					<p class="line">
						<span class="evalnum2">{{ formatEval(moveData?.eval) }}</span>
						{{ prettyLine(sanLine) }}
					</p>
					<div class="secondline">
						<span class="evalnum3">{{ moveData?.excellent_eval != null ? (moveData.excellent_eval / 100).toFixed(2) : "" }}</span>
						{{ prettyLine(excellentSanLine) }}
					</div>
					<p :style="{color: color}" class="accuracydescribtion">{{ isAccuracy }}</p>
					<p class="bestmove" v-if="movesListUCI.length > 0">{{ displayBest() }}</p>
				</div>
			</div>
			<div class="moves">
				<h2 class="movehistory">Move history</h2>
				<div class="moveslist">
					<template v-for="row in renderedMoves" :key="row.key">
						<div class="move-row" :class="{ variant: row.depth > 0 }" :style="{ '--indent': `${row.depth * 1.05}rem` }">
							<div
								v-for="(cell, index) in row.cells"
								:key="cell ? cell.key : `${row.key}-empty-${index}`"
								class="move-cell"
								:class="[{ active: cell && cell.node === currentNode, variant: cell && cell.variant }, { empty: !cell }]"
								@click="cell && jumpToNode(cell.node.id)"
							>
								<template v-if="cell">
									<span v-if="cell.showNum" class="move-num">{{ cell.displayNum }}{{ cell.isWhite ? '.' : '...' }}</span>
									<span class="move-san-text">{{ cell.node.san }}</span>
									<span v-if="cell.node.accuracy" class="acc-badge" :class="cell.node.accuracy">{{ accuracySymbol(cell.node.accuracy) }}</span>
								</template>
							</div>
						</div>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
	.grid-layout {
		padding: 1rem;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		max-width: 1600px;
		margin: 0 auto;
	}

	@media (min-width: 768px) {
		.grid-layout { grid-template-columns: 1fr 1.5fr; }
	}

	@media (min-width: 1200px) {
		.grid-layout { grid-template-columns: 1fr 2fr 1fr; gap: 2rem; }
	}

	.chessboard {
		position: relative;
		width: 100%;
		max-width: 600px;
		margin: 0 auto;
	}

	.board-area {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}

	@media (min-width: 768px) {
		.board-area {
			flex-direction: row;
			gap: 0.5rem;
			justify-content: center;
			align-items: flex-start;
		}
	}

	:deep(.cg-wrap) {
		overflow: hidden;
		width: 100%;
		aspect-ratio: 1;
		max-width: min(90vw, 35rem);
		height: auto;
		box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
		border-radius: 8px;
	}

.moves {
		margin-top: 10px;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		border-radius: 16px;
		width: 100%;
		max-width: 500px;
		height: clamp(300px, 50vh, 500px);
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
		overflow-y: auto;
		overflow-x: hidden;
		box-sizing: border-box;
		border: 1px solid rgba(255, 255, 255, 0.08);
		margin: 0 auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
	}

	@media (min-width: 1200px) {
		.moves { max-width: 20rem; }
	}

	.moveslist {
		margin: 0 auto;
		padding: 12px;
		width: 100%;
		box-sizing: border-box;
		background: linear-gradient(135deg, #a57548, #7d5530);
		border-radius: 14px;
		font-size: clamp(0.9rem, 2vw, 1rem);
		box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.move-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		align-items: start;
		margin-left: var(--indent, 0rem);
		padding-left: 0.35rem;
		position: relative;
	}

	.move-row.variant {
		border-left: 2px solid rgba(232, 232, 208, 0.16);
	}

	.move-cell {
		min-height: 2.45rem;
		padding: 0.55rem 0.7rem;
		border-radius: 12px;
		cursor: pointer;
		color: #f4f0e3;
		font-weight: 500;
		transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
		position: relative;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
		background: rgba(0, 0, 0, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.06);
		box-sizing: border-box;
		overflow: hidden;
	}

	.move-cell:hover {
		background: rgba(103, 122, 228, 0.18);
		transform: translateY(-1px);
	}

	.move-cell.active {
		background: linear-gradient(135deg, rgba(103, 122, 228, 0.42), rgba(103, 122, 228, 0.22));
		border-color: rgba(220, 228, 255, 0.7);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(103, 122, 228, 0.25);
	}

	.move-cell.active::before {
		content: '›';
		position: absolute;
		left: 0.35rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 1.35rem;
		font-weight: 800;
		line-height: 1;
		color: #fff8e8;
		text-shadow: 0 0 10px rgba(255, 255, 255, 0.25);
		animation: cursorPulse 1.2s ease-in-out infinite;
	}

	.move-cell.active .move-san-text {
		padding-left: 1rem;
	}

	.move-cell.variant {
		color: #dbe4ff;
		background: rgba(255, 255, 255, 0.06);
	}

	.move-cell.empty {
		pointer-events: none;
		background: transparent;
		border-color: transparent;
		box-shadow: none;
	}

	.move-num {
		color: rgba(232, 232, 208, 0.72);
		font-size: 0.82em;
		font-weight: 700;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.16);
		user-select: none;
		flex-shrink: 0;
	}

	.move-san-text {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes cursorPulse {
		0%, 100% { opacity: 0.7; transform: translateY(-50%) translateX(0); }
		50% { opacity: 1; transform: translateY(-50%) translateX(1px); }
	}

	.acc-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		font-size: 9px;
		font-weight: bold;
		color: white;
		margin-left: 2px;
		vertical-align: super;
	}

	.acc-badge.best { background: #3fa34d; }
	.acc-badge.excellent { background: #88b65c; }
	.acc-badge.good { background: darkgreen; }
	.acc-badge.inaccuracy { background: #f0c36d; }
	.acc-badge.mistake { background: #e67e22; }
	.acc-badge.blunder { background: #e74c3c; }
	.acc-badge.great { background: darkcyan; }
	.acc-badge.book { background: #aa8b6c; }
	.acc-badge.brilliant { background: lightblue; }

	.analyze {
		margin-top: -7px;
		border-radius: 15px;
		width: 100%;
		max-width: 500px;
		min-height: 250px;
		height: auto;
		padding-bottom: 1rem;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		box-sizing: border-box;
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.08);
		margin: auto;
		margin-bottom: 1.5rem;
	}

	@media (min-width: 1200px) {
		.analyze { max-width: 20rem; }
	}

	.analyzis {
		color: #f5f5dc;
		text-align: center;
		font-weight: 600;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
		letter-spacing: 0.5px;
		font-size: clamp(1.2rem, 3vw, 1.5rem);
	}

	.movehistory {
		position: sticky;
		text-align: center;
		color: #f5f5dc;
		font-weight: 600;
		margin: 12px 0;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
		letter-spacing: 0.5px;
		font-size: clamp(1.2rem, 3vw, 1.5rem);
	}

	.boardtools {
		display: flex;
		gap: 1rem;
		justify-content: center;
		align-items: center;
		height: auto;
		min-height: 3.2rem;
		width: 100%;
		max-width: 600px;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		border: 2px solid rgba(182, 173, 144, 0.4);
		padding: 0.5rem 1rem;
		border-radius: 10px;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		margin: 0 auto;
		flex-wrap: wrap;
		position: relative;
	}

	.reverse, .undo, .redo, .reset {
		background-color: #9d6639;
		width: clamp(35px, 8vw, 40px);
		height: clamp(35px, 8vw, 40px);
		border: none;
		border-radius: 15px;
		font-size: clamp(16px, 4vw, 20px);
		color: #e8e8d0;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.reverse:disabled, .undo:disabled, .redo:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.reversetip, .undotip, .redotip, .resettip {
		display: none;
	}

	@media (min-width: 768px) {
		.reversetip, .undotip, .redotip, .resettip {
			display: block;
			opacity: 0;
			position: absolute;
			font-size: clamp(14px, 2vw, 17px);
			padding: 0.5rem;
			border-radius: 10px;
			text-align: center;
			background-color: #242424;
			pointer-events: none;
			white-space: nowrap;
			margin-top: -4.5rem;
			transform: translateX(-50%);
			left: 50%;
		}

		.reverse:hover + .reversetip,
		.undo:hover + .undotip,
		.redo:hover + .redotip,
		.reset:hover + .resettip {
			animation-name: fadeIn;
			animation-duration: 0.4s;
			animation-fill-mode: forwards;
			animation-delay: 0.3s;
		}
	}

	.reverse:hover:not(:disabled),
	.undo:hover:not(:disabled),
	.redo:hover:not(:disabled),
	.reset:hover {
		background: linear-gradient(145deg, #9d6640, #7d5530);
		border-color: rgba(232, 232, 208, 0.6);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
	}

	.reverse:active, .undo:active, .redo:active, .reset:active {
		transform: translateY(2px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 0.8; }
	}

	.evalbar {
		width: 90%;
		max-width: min(90vw, 35rem);
		height: clamp(30px, 5vw, 40px);
		max-height: 40px;
		display: flex;
		flex-direction: row;
		position: relative;
		border-radius: 10px;
		overflow: hidden;
	}

	@media (min-width: 768px) {
		.evalbar {
			width: clamp(30px, 5vw, 40px);
			height: 100%;
			max-height: min(95vw, 36.5rem);
			flex-direction: column;
			flex-shrink: 0;
		}
	}

	.blackeval, .whiteeval {
		width: 100%;
		transition: all 0.5s ease;
		position: relative;
	}

	.blackeval {
		background-color: #38412e;
		border-radius: 10px 10px 0 0;
	}

	@media (max-width: 767px) {
		.blackeval { border-radius: 10px 0 0 10px; }
	}

	.whiteeval {
		background-color: #626949;
		border-radius: 0 0 10px 10px;
	}

	@media (max-width: 767px) {
		.whiteeval { border-radius: 0 10px 10px 0; }
	}

	.evalnum {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: clamp(0.9rem, 2vw, 1.1rem);
		font-weight: 700;
		color: #fff8ef;
		text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.6);
		background: rgba(0, 0, 0, 0.3);
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		text-align: center;
		backdrop-filter: blur(4px);
		white-space: nowrap;
		z-index: 10;
	}

	.accuracydescribtion {
		text-align: center;
		font-size: clamp(1.1rem, 3vw, 1.5rem);
		margin-top: 1rem;
		padding: 0 1rem;
		word-wrap: break-word;
	}

	.bestmove {
		color: #41a24e;
		text-align: center;
		margin-top: 0.5rem;
		font-size: clamp(0.9rem, 2vw, 1rem);
		padding: 0 1rem;
	}

	.move-data { padding: 0 1rem; }

	.depthnum {
		text-align: center;
		color: #f5f5dc;
		font-size: clamp(0.9rem, 2vw, 1rem);
		margin: 0.5rem 0;
	}

	.line {
		font-family: "JetBrains Mono", monospace;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: clamp(0.85rem, 2vw, 1rem);
		min-height: 40px;
		padding: 0.5rem;
		margin: 8px 0;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 10px;
		color: #eae4d8;
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4);
		word-break: break-word;
		max-height: 80px;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
	}

	.evalnum2 {
		font-size: clamp(1.1rem, 2.5vw, 1.5rem);
		font-weight: 700;
		color: #fff4e6;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
		flex-shrink: 0;
	}

	.secondline {
		font-family: "JetBrains Mono", monospace;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: clamp(0.85rem, 2vw, 1rem);
		min-height: 40px;
		padding: 0.5rem;
		margin: 8px 0;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 10px;
		color: #eae4d8;
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4);
		word-break: break-word;
		max-height: 80px;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: rgba(194, 197, 170, 0.4) rgba(0, 0, 0, 0.2);
	}

	.evalnum3 {
		font-size: clamp(1rem, 2vw, 1.5rem);
		font-weight: 700;
		color: #fff4e6;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
		flex-shrink: 0;
	}
</style>