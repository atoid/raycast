"use strict";

// Kiky-maze (c) 2019 Matti Kantola apophis@kajaani.net

const DBGLEVEL = 1;
const DISABLE_LOCKS = true;

const COLLISION_MARGIN = 4;
const RAY_MARGIN = 580;
const CAST_MAX_DEPTH = 3;
const BLOCK_SIZE = 20;
const TEXTURE_SIZE = 512;
const NEAR_MARGIN = 400;
const INTERACT_MARGIN = 300;
const MOVE_FWD_SPEED = 3;
const MOVE_REV_SPEED = -3;
const TURN_SPEED = (Math.PI/50);
const NUM_RAYS = 500;
const OFFSET_INTERACT_SAMPLES = 20;
const CULL_NEAR_MARGIN = 150;
const CULL_FAR_MARGIN = -9000;
const CULL_SIDE_MARGIN = 600;
const IN_FRONT_MARGIN = 0;

var camera;
var map;
var mapData = [];
var attributes = [];
var textures = [];
var samples = [];
var interacts = [
    undefined,
    interact_Door,
    interact_Panel,
    interact_Secret,
    interact_Item,
    interact_End,
    interact_Audio
];
var keys = [];
var keysRepeat = [];
var gameTime = "00:00:00";
var gameStarted = false;
var gameCompleted = false;
var framesRender = 0;
var frameTime = 0;

//var width = window.innerWidth-20;
//var height = Math.floor(1.0*window.innerHeight)-20;
var width = NUM_RAYS*2 + 30;
var height = 600;
var ctx;
var floorGradient;
var ceilingGradient;

function DBG(m, level)
{
    if ((level && level <= DBGLEVEL) || DBGLEVEL == 3)
    {
        console.log(m);
    }
}

function project(p)
{
    return {x: width - 450 + (p.x/1.5), y: 50 + (p.y/1.5)};    
}

function projectToLine(i, d)
{
    var z = Math.sqrt(d);

    var x = 10 + i;
    var h = 8000 / z;
    var y0 = 300 - h;
    var y1 = 300 + h;

    var c = 255 - Math.round(z);
    if (c < 0)
    {
        c = 0;
    }
    
    var alpha = c / 255;
    
    return {
        p0: {x: 2*x, y: y0},
        p1: {x: 2*x, y: y1},
        alpha: alpha
    }
}

class Map {
    constructor(data, camera)
    {
        DBG("Map()", 1);
        
        this.blockSize = BLOCK_SIZE;
        
        this.data = data;
        this.init(camera);
    }

    parseAttr(attr)
    {
        return {
            texture: attr & 0xff,
            target: (attr >> 8) & 0xfff,
            interact: interacts[(attr >> 20) & 0xf],
            params: (attr >> 24) & 0xf,
            lock: DISABLE_LOCKS ? 0 : (attr >> 28) & 0xf
        }   
    }
    
    init(camera)
    {
        var sx = 0;
        var y = 0;
        
        this.blocks = [];
        var blockIndex = 0;
        for (var l of this.data)
        {
            var x = sx;

            for (var b of l)
            {
                if (b != " ")
                {
                    var attr = attributes[blockIndex];
                    var block = {
                        block: {
                            type: b, 
                            index: blockIndex,
                            attr: this.parseAttr(attr)
                        },
                        center: {x: x+this.blockSize/2, y: y-this.blockSize/2}
                    }
                
                    switch (b) {
                    case 'S':
                        camera.move(block.center.x, block.center.y);
                        block = undefined;
                        break;
                    case '|':
                        block.l1 = {x: x+this.blockSize/2};
                        block.l2 = {x: x+this.blockSize/2};
                        block.l3 = {y: y, ray: 0};
                        block.l4 = {y: y-this.blockSize, ray: 0};
                        break;
                    case '-':
                        block.l1 = {x: x, ray: 0};
                        block.l2 = {x: x+this.blockSize, ray: 0};
                        block.l3 = {y: y-this.blockSize/2};
                        block.l4 = {y: y-this.blockSize/2};
                        break;
                    case 'H':
                        block.l1 = {x: x, ray: 0};
                        block.l2 = {x: x+this.blockSize, ray: 0};
                        block.l3 = {y: y};
                        block.l4 = {y: y-this.blockSize};
                        break;
                    case 'V':
                        block.l1 = {x: x};
                        block.l2 = {x: x+this.blockSize};
                        block.l3 = {y: y, ray: 0};
                        block.l4 = {y: y-this.blockSize, ray: 0};
                        break;
                    default:
                        block.l1 = {x: x};
                        block.l2 = {x: x+this.blockSize};
                        block.l3 = {y: y};
                        block.l4 = {y: y-this.blockSize};
                        break;
                    }
                    
                    if (block)
                    {
                        this.blocks.push(block);
                    }
                }
                x += this.blockSize;
                blockIndex++;
            }
            
            y += this.blockSize;
        }
    }

    inBlock(x, y)
    {
        for (var b of this.nearest)
        {
            var tex = textures[b.block.attr.texture];
        
            if (tex.pass)
            {
                continue;
            }
        
            if ( x >= b.l1.x-COLLISION_MARGIN && 
                 x <= b.l2.x+COLLISION_MARGIN &&
                 y <= b.l3.y+COLLISION_MARGIN &&
                 y >= b.l4.y-COLLISION_MARGIN)
            {
                return true;
            }
        }
    }
    
    intersect(ray, maxDepth)
    {
        var pt = [];
    
        for (var b of this.visible)
        {
            if (Math.abs(ray.value(b.center)) < RAY_MARGIN)
            {
                var p = ray.intersectSquare(b); 
                if (camera.inFront(p))
                {
                    p.block = b.block;
                    pt.unshift(p);
                    if (pt.length >= maxDepth)
                    {
                        break;
                    }
                }
            }
        }
                
        return pt;
    }

    findBlock(index)
    {
        for (var b of this.blocks)
        {
            if (b.block.index == index)
            {
                return b;
            }
        }
    }
    
    gotoBlock(index)
    {
        var block = this.findBlock(index);
        camera.move(block.center.x-BLOCK_SIZE, block.center.y);
    }
    
    doCull(camera)
    {
        var visible = [];
        this.nearest = [];
        for (var b of this.blocks)
        {
            b.distance = (b.center.x - camera.po.x) ** 2 + (b.center.y - camera.po.y) ** 2;
            
            if (b.distance < NEAR_MARGIN)
            {
                this.nearest.push(b);
            }
            
            if (camera.cull(b))
            {
                visible.push(b);
            }
        }
        
        return visible;
    }

    sortBlocks(visible)
    {
        visible.sort(function(a, b) {
            return a.distance - b.distance;
        });
    }
    
    drawLine(p0, p1, ray)
    {
        ctx.strokeStyle = (ray == 0) ? "#444444" : "#ffffff";
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
    }

    drawBlocks(b)
    {
        for (var b of this.blocks)
        {
            let p0 = project({x: b.l1.x, y: b.l3.y});
            let p1 = project({x: b.l2.x, y: b.l3.y});
            let p2 = project({x: b.l2.x, y: b.l4.y});
            let p3 = project({x: b.l1.x, y: b.l4.y});
            this.drawLine(p0, p1, b.l3.ray);
            this.drawLine(p1, p2, b.l2.ray);
            this.drawLine(p2, p3, b.l4.ray);
            this.drawLine(p3, p0, b.l1.ray);
        }
    }
    
    draw(camera, blocks, cast)
    {
        this.visible = this.doCull(camera);
        this.sortBlocks(this.visible);

        if (blocks)
        {
            this.drawBlocks();
            camera.draw();
        }   

        if (!cast)
        {
            return;
        }
        
        camera.initRays();       
        //console.time("raycast");
        var ray = camera.getRay()
        while (ray)
        {
            var pt = this.intersect(ray, CAST_MAX_DEPTH);
                        
            for (var p0 of pt)
            {
                var l = projectToLine(ray.rayIndex, p0.d);
                var dx = p0.x - p0.cx;
                var dy = p0.y - p0.cy;
                var tx = Math.floor((TEXTURE_SIZE/BLOCK_SIZE) * Math.sqrt(dx*dx + dy*dy));

                var id = p0.block.index;
                var tex = textures[p0.block.attr.texture];
                
                if (tex.mask)
                {
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(tex.mask, tx, 0, 1, TEXTURE_SIZE, l.p0.x, l.p0.y, 2, l.p1.y-l.p0.y);
                }
                ctx.globalAlpha = l.alpha;
                ctx.drawImage(tex.tx, tx, 0, 1, TEXTURE_SIZE, l.p0.x, l.p0.y, 2, l.p1.y-l.p0.y);
            }
             
            ray = camera.getRay();
        }
        //console.timeEnd("raycast");
        ctx.globalAlpha = 1.0;
    }
}

class Camera {
    constructor()
    {
        DBG("Camera()", 1);
    
        this.numRays = NUM_RAYS;
        this.width = Math.PI / 6;
        this.pdist = 40;
        this.angle = 0;
        this.pl = {};
        this.pr = {};
        this.po = {};
        this.xPos = 0;
        this.yPos = 0;
        this.rotate(0);
    }
    
    move(x, y)
    {
        this.xPos = x;
        this.yPos = y;
    }
    
    rotate(angle)
    {

        this.angle = angle;
        this.pl = {x: this.pdist * Math.cos(angle - this.width), y: this.pdist * Math.sin(angle - this.width)};
        this.pr = {x: this.pdist * Math.cos(angle + this.width), y: this.pdist * Math.sin(angle + this.width)};
        this.po = {x: this.xPos, y: this.yPos};
        this.pf = {x: this.pdist * Math.cos(angle + Math.PI/2), y: this.pdist * Math.sin(angle + Math.PI/2)};
        this.pc = {x: this.pdist * Math.cos(angle), y: this.pdist * Math.sin(angle)};
        
        this.pl.x += this.xPos;
        this.pl.y += this.yPos;
        this.pr.x += this.xPos;
        this.pr.y += this.yPos;
        this.pf.x += this.xPos;
        this.pf.y += this.yPos;
        this.pc.x += this.xPos;
        this.pc.y += this.yPos;
        
        this.makeCullLines();
    }
        
    compRight(l, pt)
    {
        return l.value(pt) <= 0;
    }
    
    compRight(l, pt)
    {
        return l.value(pt) >= 0;
    }
    
    makeCullLines()
    {
        this.leftCull = new Line(this.po, this.pl);
        this.rightCull = new Line(this.po, this.pr);
        this.frontCull = new Line(this.po, this.pf);
    }
    
    cull(sq)
    {
        if (this.frontCull.value(sq.center) <= CULL_NEAR_MARGIN)
        {
            if (this.frontCull.value(sq.center) >= CULL_FAR_MARGIN)
            {
                if (this.leftCull.value(sq.center) > -CULL_SIDE_MARGIN)
                {
                    return this.rightCull.value(sq.center) < CULL_SIDE_MARGIN;
                }
            }
        }
    }

    inFront(p)
    {
        if (p && this.frontCull.value(p) <= IN_FRONT_MARGIN)
        {
            return true;
        }
    }
    
    initRays()
    {
        this.ray = {x: this.pl.x, y: this.pl.y};
        this.xadd = (this.pr.x - this.pl.x) / this.numRays;
        this.yadd = (this.pr.y - this.pl.y) / this.numRays;
        this.rayIndex = 0;
    }

    getCenterRay()
    {
        return new Line(this.po, this.pc);
    }
    
    getRay()
    {
        if (this.rayIndex < this.numRays)
        {
            var res = new Line(this.po, this.ray);
            res.rayIndex = this.rayIndex;
            this.ray.x += this.xadd;
            this.ray.y += this.yadd;
            this.rayIndex++;
            return res;
        }
    }
    
    draw()
    {
        let p0 = project(this.pl);
        let p1 = project(this.pr);
        let p2 = project(this.po);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p0.x, p0.y);
        ctx.stroke();
    }
}

class Line
{
    constructor(p0, p1)
    {
        this.p0 = p0;
        this.p1 = p1;
        
        this.A = p0.y - p1.y;
        this.B = p1.x - p0.x;
        this.C = p0.x*p1.y - p1.x*p0.y;
    }

    value(p)
    {
        return this.A * p.x + this.B * p.y + this.C;
    }
    
    intersectX(x)
    {
        // Intersect vertical line at x
        // Ax + By + C = 0
        // By = -Ax - C
        //  y = (-Ax - C) / B

        if (this.B)
        {
            var y = (-this.A * x - this.C) / this.B;
            return { x: x, y: y};
        }
    }
    
    intersectY(y)
    {
        // Intersect horizontal line at y
        // Ax + By + C = 0
        // Ax = -By - C
        //  x = (-By - C) / A

        if (this.A)
        {
            var x = (-this.B * y - this.C) / this.A;
            return { x: x, y: y};
        }
    }
    
    intersect(l, pt, cx, cy)
    {
        if (l.ray != 0)
        {
            var p;
            if (l.x != undefined)
            {
                p = this.intersectX(l.x);
            }
            if (l.y != undefined)
            {
                p = this.intersectY(l.y);
            }
            if (p)
            {
                p.cx = cx;
                p.cy = cy;
                pt.push(p);
            }
        }
    }
    
    intersectSquare(sq)
    {
        var pt = [];
        
        this.intersect(sq.l1, pt, sq.l1.x, sq.l3.y);
        this.intersect(sq.l2, pt, sq.l2.x, sq.l3.y);
        this.intersect(sq.l3, pt, sq.l1.x, sq.l3.y);
        this.intersect(sq.l4, pt, sq.l1.x, sq.l4.y);
        
        var res = [];
        for (var p of pt)
        {
            if (p.x >= sq.l1.x && p.x <= sq.l2.x && p.y <= sq.l3.y && p.y >= sq.l4.y)
            {
                p.d = (p.x - this.p0.x) ** 2 + (p.y - this.p0.y) ** 2;
                res.push(p);
            }
        }

        res.sort(function(a, b) {
            return a.d - b.d;
        });
        
        return res[0];
    }
}

function interact_Door(b)
{
    DBG("Door access", 2);

    var attr = b.block.attr;
    if (attr.lock == 0)
    {
        var tex = textures[attr.texture];
        attr.texture = tex.alt;
        playSample(2);
    }
    else
    {
        playSample(4);
        addMessage("Ovi on lukossa");
    }
}

function interact_Panel(b)
{
    DBG("Panel access", 2);

    var code = parseInt(prompt("Enter code"));

    playSample(3, function() {
        var attr = b.block.attr;
        var currTex = attr.texture;
        var tex = textures[currTex];
        var codeOk = (b.block.index % 100).toString();
        var tgtAttr = map.findBlock(attr.target).block.attr;
        
        if (code == codeOk && currTex != tex.alt)
        {
            attr.texture = tex.alt;
            tgtAttr.lock--;
        }
        else if (code != codeOk && currTex != tex.default)
        {
            attr.texture = tex.default;
            tgtAttr.lock++;
        }

        addMessage(code == codeOk ? "Oikea koodi" : "Väärä koodi");

        // prompt steals focus
        keys[4] = false;
        keysRepeat[4] = false;

        DBG("Lock: " + tgtAttr.lock, 2);
    });
}

function interact_Secret(b)
{
    DBG("Secret access", 2);

    var attr = b.block.attr;

    if (attr.lock == 0 && !attr.moving)
    {
        playSample(5);
        attr.moving = true;
        var distance = 0;
        var ref = map.findBlock(b.block.index);
        var iv = setInterval(function() {
            ref.l3.y++;
            ref.l4.y++;
            ref.center.y++;
            distance++;
            if (distance >= 40)
            {
                clearInterval(iv);
            }
        }, 50);
        addMessage("Salakäytävä!");
    }
    else
    {
        playSample(4);
    }
}

function interact_Item(b)
{
    DBG("Item access", 2);

    var attr = b.block.attr;
    var tgtAttr = map.findBlock(attr.target).block.attr;
    tgtAttr.lock = 0;

    b = map.findBlock(b.block.index);
    
    b.l1.ray = 0;
    b.l2.ray = 0;
    b.l3.ray = 0;
    b.l4.ray = 0;

    playSample(6);
    addMessage("Avain vapauteen!");
}

function interact_End(b)
{
    DBG("End access", 2);

    var attr = b.block.attr;
    if (attr.lock == 0)
    {
        gameCompleted = true;
        var tex = textures[attr.texture];
        attr.texture = tex.alt;
        attr.lock = -1;
        playSample(7);
        addMessage("Selvisit ulos!");
    }

    if (attr.lock > 0)
    {
        playSample(4);
    }
}

function interact_Audio(b)
{
    DBG("Audio access", 2);

    var attr = b.block.attr;
    var id = attr.params + OFFSET_INTERACT_SAMPLES;
    playSample(id);
}

function moveCamera(r, angle)
{
    var nx = camera.xPos + Math.cos(angle) * r;
    var ny = camera.yPos + Math.sin(angle) * r;

    if (!map.inBlock(nx, ny))
    {
        camera.xPos = nx;
        camera.yPos = ny;
    }
    else if (!map.inBlock(nx, camera.yPos))
    {
        camera.xPos = nx;
    } 
    else if (!map.inBlock(camera.xPos, ny))
    {
        camera.yPos = ny;
    }
}

function playSample(id, callback)
{
    var s = samples[id];
    var elem = s.snd;
    
    if (s.volume)
    {
        elem.volume = s.volume;
    }

    if (s.loop)
    {
        elem.loop = true;
    }

    elem.onended = callback;
    elem.currentTime = 0;
    elem.play();
}

function addMessage(msg)
{
    var r1 = document.getElementById("row_1");
    var r2 = document.getElementById("row_2");
    var r3 = document.getElementById("row_3");
    var r4 = document.getElementById("row_4");

    r1.innerHTML = r2.innerHTML;
    r2.innerHTML = r3.innerHTML;
    r3.innerHTML = r4.innerHTML;
    r4.innerHTML = msg;
}

function getLevel()
{
    // from level.js
    mapData = level1.blocks;
    attributes = level1.attributes;

    // directly from level editor
    if (localStorage.getItem("map_editor"))
    {
        var data = localStorage.getItem("map_data");
        if (data != null)
        {
            var map_w = parseInt(localStorage.getItem("map_w"));
            var map_h = parseInt(localStorage.getItem("map_h"));
            var offset = 0;
            mapData = [];
            for (var i = 0; i < map_h; i++)
            {
                var l = data.substr(offset, map_w);
                mapData.push(l);
                offset += map_w;
            }
        }

        data = localStorage.getItem("map_attributes");
        if (data != null)
        {
            attributes = [];
            data.split(",").forEach(function(elem) {
                attributes.push(parseInt(elem));
            });
        }        
    }
}

function draw(blocks, cast)
{
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#ffffff";
    
    if (cast)
    {
        ctx.fillStyle = ceilingGradient;
        ctx.fillRect(20, 0, 1000, 300);
        
        ctx.fillStyle = floorGradient;
        ctx.fillRect(20, 320, 1000, height-300);
    }
    
    map.draw(camera, blocks, cast);
}

function registerMouseEvents(id)
{
    var elem = document.getElementById("ctrl_" + id);

    elem.onmousedown = function(event) {
        onControls(event, id, true);
    }

    elem.onmouseup = function(event) {
        onControls(event, id, false);
    }

    elem.onmouseover = function(event) {
        onControls(event, id, event.buttons == 1);
    }
    
    elem.onmouseleave = function(event) {
        onControls(event, id, false);
    }
}

function onControls(event, id, active)
{
    if (active)
    {
        beginGame();
        keys[id] = true;
    }
    else
    {
        keys[id] = false;
        keysRepeat[4] = false;
    }
}

function beginGame()
{
    if (!gameStarted)
    {
        playSample(1);
        gameStarted = true;
        gameCompleted = false;
        gameTime = new Date();
        frameTime = new Date();
    }
}

function getTimeStr(d)
{
    d = Math.round(d/1000);
    var sec = d % 60;
    var min = Math.floor(d/60) % 60;
    var hr = Math.floor(d/3600);

    var str = (hr < 10 ? "0" : "") + hr + ":";
    str += (min < 10 ? "0" : "") + min + ":";
    str += (sec < 10 ? "0" : "") + sec;
    return str;
}

function gameInit()
{
    DBG("Params: " + document.location.hash, 1);
    var params = document.location.hash.substr(1).split(":");
    for (var i in params)
    {
        eval(params[i]);
    }
    
    var elem = document.getElementById("myCanvas");
    elem.width = width;
    elem.height = height;
    ctx = elem.getContext("2d");
    
    ceilingGradient = ctx.createLinearGradient(0, 0, 0, 300);
    ceilingGradient.addColorStop(0, "blue");
    ceilingGradient.addColorStop(0.9, "black");

    floorGradient = ctx.createLinearGradient(0, 300, 0, height);
    floorGradient.addColorStop(0.1, "black");
    floorGradient.addColorStop(1, "white");
    
    camera = new Camera();
    getLevel();
    map = new Map(mapData, camera);
    
    var angle = 0;

    setInterval(function() {
        handleInputs();
        camera.rotate(angle);
    }, 50);
    
    setInterval(function() {
        draw(false, true);
        framesRender++;
    }, 30);

    setInterval(function() {
        if (gameStarted && !gameCompleted)
        {
            var now = new Date();
            var d = new Date(now - gameTime);
            var elem = document.getElementById("game_time");
            elem.innerHTML = getTimeStr(d);
        
            DBG("Frames rendered: " + framesRender + ", time(ms):" + ((now-frameTime) / framesRender).toFixed(1), 2);
            framesRender = 0;
            frameTime = now;
        }
    }, 500);
    
    function handleInputs()
    {
        if (keys[0])
        {
            angle -= TURN_SPEED;
        }
        if (keys[1])
        {
            angle += TURN_SPEED;
        }
        if (keys[2])
        {
            moveCamera(MOVE_FWD_SPEED, angle);
        }
        if (keys[3])
        {
            moveCamera(MOVE_REV_SPEED, angle);
        }
        
        if (keys[4] && !keysRepeat[4])
        {
            var b = map.intersect(camera.getCenterRay(), 1)[0];
            if (b && b.d <= INTERACT_MARGIN && b.block.attr.interact)
            {
                b.block.attr.interact(b);
            }
            keysRepeat[4] = true;
        }
        
        for (var id = 0 ; id < 5; id++)
        {
            var hl = keys[id];
            var elem = document.getElementById("ctrl_" + id);
            elem.className = hl ? "hl-input" : "";
        }
    }
    
    document.addEventListener('keydown', function(event) {
        beginGame();
    
        switch (event.key) {
        
        case "ArrowLeft":
        case "a":
            keys[0] = true;
            break;
        case "ArrowRight":
        case "d":
            keys[1] = true;
            break;
        case "ArrowUp":
        case "w":
            keys[2] = true;
            break;
        case "ArrowDown":
        case "s":
            keys[3] = true;
            break;
        case " ":
        case "e":
            keys[4] = true;
            break;
        default:
            break;
        }
    });

    document.addEventListener('keyup', function(event) {
        switch (event.key) {
        
        case "ArrowLeft":
        case "a":
            keys[0] = false;
            break;
        case "ArrowRight":
        case "d":
            keys[1] = false;
            break;
        case "ArrowUp":
        case "w":
            keys[2] = false;
            break;
        case "ArrowDown":
        case "s":
            keys[3] = false;
            break;
        case " ":
        case "e":
            keys[4] = false;
            keysRepeat[4] = false;
            break;
        default:
            break;
        }
    });
    
    textures[1] = {tx: document.getElementById("tx_wall"), mask: document.getElementById("tx_wall_mask")};
    textures[2] = {tx: document.getElementById("tx_ournament"), mask: document.getElementById("tx_wall_mask")};
    textures[3] = {tx: document.getElementById("tx_door_open"), mask: document.getElementById("tx_door_open_mask"), alt: 4, pass: true};
    textures[4] = {tx: document.getElementById("tx_door"), mask: document.getElementById("tx_wall_mask"), alt: 3};
    textures[5] = {tx: document.getElementById("tx_door_red"), mask: document.getElementById("tx_wall_mask"), alt: 6};
    textures[6] = {tx: document.getElementById("tx_door_open"), mask: document.getElementById("tx_door_open_mask"), alt: 5, pass: true};
    textures[7] = {tx: document.getElementById("tx_code_ok"), mask: document.getElementById("tx_wall_mask"), alt: 7, default: 8};
    textures[8] = {tx: document.getElementById("tx_code_fail"), mask: document.getElementById("tx_wall_mask"), alt: 7, default: 8};
    textures[9] = {tx: document.getElementById("tx_avain"), mask: document.getElementById("tx_avain_mask"), pass: true};
    textures[10]= {tx: document.getElementById("tx_tl3"), mask: document.getElementById("tx_wall_mask")};
    textures[11]= {tx: document.getElementById("tx_pete"), mask: document.getElementById("tx_wall_mask")};
    textures[12]= {tx: document.getElementById("tx_humg"), mask: document.getElementById("tx_wall_mask")};
    textures[13]= {tx: document.getElementById("tx_hudson"), mask: document.getElementById("tx_wall_mask")};

    samples[1] = {snd: document.getElementById("snd_wind"), volume: 0.1, loop: true};
    samples[2] = {snd: document.getElementById("snd_door"), volume: 0.7};
    samples[3] = {snd: document.getElementById("snd_code"), volume: 0.7};
    samples[4] = {snd: document.getElementById("snd_locked"), volume: 0.6};
    samples[5] = {snd: document.getElementById("snd_secret"), volume: 0.6};
    samples[6] = {snd: document.getElementById("snd_item"), volume: 0.6};
    samples[7] = {snd: document.getElementById("snd_end"), volume: 0.6};

    samples[20] = {snd: document.getElementById("snd_0"), volume: 0.6};
    samples[21] = {snd: document.getElementById("snd_1"), volume: 0.6};
    samples[22] = {snd: document.getElementById("snd_2"), volume: 0.6};
    samples[23] = {snd: document.getElementById("snd_3"), volume: 0.6};
    samples[24] = {snd: document.getElementById("snd_4"), volume: 0.6};
    
    registerMouseEvents(0);
    registerMouseEvents(1);
    registerMouseEvents(2);
    registerMouseEvents(3);
    registerMouseEvents(4);
    
    DBG("Init complete", 1);
}
