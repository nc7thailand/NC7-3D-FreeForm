;; Per-angle silhouette occupancy raster.
;; Matches fillProjectedTriangle / pointInTriUV / projectToSection in
;; src/lib/silhouette.js. Contour tracing stays in JS (d3-contour).
;; MVP only: no shared memory, no threads.
(module
  (memory (export "memory") 1)

  (func $min3 (param $a f64) (param $b f64) (param $c f64) (result f64)
    (f64.min (f64.min (local.get $a) (local.get $b)) (local.get $c)))

  (func $max3 (param $a f64) (param $b f64) (param $c f64) (result f64)
    (f64.max (f64.max (local.get $a) (local.get $b)) (local.get $c)))

  ;; Math.floor for finite values that fit in i32. Out of range saturates.
  (func $floor (param $x f64) (result i32)
    (local $t i32)
    (if (f64.ne (local.get $x) (local.get $x))
      (then (return (i32.const 0))))
    (if (f64.gt (local.get $x) (f64.const 2147483647))
      (then (return (i32.const 2147483647))))
    (if (f64.lt (local.get $x) (f64.const -2147483648))
      (then (return (i32.const -2147483648))))
    (local.set $t (i32.trunc_f64_s (local.get $x)))
    (if (f64.gt (f64.convert_i32_s (local.get $t)) (local.get $x))
      (then (return (i32.sub (local.get $t) (i32.const 1)))))
    (local.get $t))

  ;; Math.ceil, same range as $floor.
  (func $ceil (param $x f64) (result i32)
    (local $f i32)
    (local.set $f (call $floor (local.get $x)))
    (if (f64.ne (f64.convert_i32_s (local.get $f)) (local.get $x))
      (then (return (i32.add (local.get $f) (i32.const 1)))))
    (local.get $f))

  (func $vertex (param $index i32) (param $indexCount i32) (param $t i32) (param $k i32) (result i32)
    (if (result i32) (i32.gt_s (local.get $indexCount) (i32.const 0))
      (then
        (i32.load
          (i32.add
            (local.get $index)
            (i32.mul
              (i32.add (i32.mul (local.get $t) (i32.const 3)) (local.get $k))
              (i32.const 4)))))
      (else
        (i32.add (i32.mul (local.get $t) (i32.const 3)) (local.get $k)))))

  ;; u = (x - px) * ux + (z - pz) * uz. Position is float32, math is float64.
  (func $coord_u (param $pos i32) (param $vert i32) (param $px f64) (param $pz f64) (param $ux f64) (param $uz f64) (result f64)
    (local $base i32)
    (local.set $base (i32.add (local.get $pos) (i32.mul (local.get $vert) (i32.const 12))))
    (f64.add
      (f64.mul
        (f64.sub (f64.promote_f32 (f32.load (local.get $base))) (local.get $px))
        (local.get $ux))
      (f64.mul
        (f64.sub (f64.promote_f32 (f32.load offset=8 (local.get $base))) (local.get $pz))
        (local.get $uz))))

  (func $coord_v (param $pos i32) (param $vert i32) (param $py f64) (result f64)
    (f64.sub
      (f64.promote_f32
        (f32.load offset=4
          (i32.add (local.get $pos) (i32.mul (local.get $vert) (i32.const 12)))))
      (local.get $py)))

  ;; Returns 1 after filling grid, 0 if the arguments are not a mesh.
  (func (export "raster")
    (param $pos i32) (param $floatCount i32)
    (param $index i32) (param $indexCount i32)
    (param $grid i32) (param $uBins i32) (param $vBins i32)
    (param $uMin f64) (param $vMin f64) (param $uStep f64) (param $vStep f64)
    (param $px f64) (param $py f64) (param $pz f64)
    (param $ux f64) (param $uz f64)
    (result i32)
    (local $cells i32)
    (local $i i32)
    (local $triCount i32)
    (local $t i32)
    (local $i0 i32) (local $i1 i32) (local $i2 i32)
    (local $vertCount i32)
    (local $au f64) (local $av f64)
    (local $bu f64) (local $bv f64)
    (local $cu f64) (local $cv f64)
    (local $minU f64) (local $maxU f64)
    (local $minV f64) (local $maxV f64)
    (local $iu0 i32) (local $iu1 i32)
    (local $iv0 i32) (local $iv1 i32)
    (local $iu i32) (local $iv i32)
    (local $u f64) (local $v f64)
    (local $denom f64) (local $w0 f64) (local $w1 f64) (local $w2 f64)
    (local $e0u f64) (local $e0v f64) (local $e1u f64) (local $e1v f64)
    (local $dv f64) (local $du f64) (local $rowB0 f64) (local $rowB1 f64)
    (local $limit i32)
    (local $row i32)
    (local $seen i32)

    (if (i32.or
          (i32.le_s (local.get $uBins) (i32.const 0))
          (i32.le_s (local.get $vBins) (i32.const 0)))
      (then (return (i32.const 0))))
    (if (i32.lt_s (local.get $floatCount) (i32.const 9))
      (then (return (i32.const 0))))

    (local.set $cells (i32.mul (local.get $uBins) (local.get $vBins)))
    (memory.fill (local.get $grid) (i32.const 0) (local.get $cells))

    (local.set $vertCount (i32.div_u (local.get $floatCount) (i32.const 3)))
    (if (i32.gt_s (local.get $indexCount) (i32.const 0))
      (then (local.set $triCount (i32.div_u (local.get $indexCount) (i32.const 3))))
      (else (local.set $triCount (i32.div_u (local.get $floatCount) (i32.const 9)))))

    (local.set $t (i32.const 0))
    (block $tDone
      (loop $tLoop
        (br_if $tDone (i32.ge_u (local.get $t) (local.get $triCount)))
        (local.set $i0 (call $vertex (local.get $index) (local.get $indexCount) (local.get $t) (i32.const 0)))
        (local.set $i1 (call $vertex (local.get $index) (local.get $indexCount) (local.get $t) (i32.const 1)))
        (local.set $i2 (call $vertex (local.get $index) (local.get $indexCount) (local.get $t) (i32.const 2)))
        (if (i32.or
              (i32.or
                (i32.ge_u (local.get $i0) (local.get $vertCount))
                (i32.ge_u (local.get $i1) (local.get $vertCount)))
              (i32.ge_u (local.get $i2) (local.get $vertCount)))
          (then
            (local.set $t (i32.add (local.get $t) (i32.const 1)))
            (br $tLoop)))

        (local.set $au (call $coord_u (local.get $pos) (local.get $i0) (local.get $px) (local.get $pz) (local.get $ux) (local.get $uz)))
        (local.set $av (call $coord_v (local.get $pos) (local.get $i0) (local.get $py)))
        (local.set $bu (call $coord_u (local.get $pos) (local.get $i1) (local.get $px) (local.get $pz) (local.get $ux) (local.get $uz)))
        (local.set $bv (call $coord_v (local.get $pos) (local.get $i1) (local.get $py)))
        (local.set $cu (call $coord_u (local.get $pos) (local.get $i2) (local.get $px) (local.get $pz) (local.get $ux) (local.get $uz)))
        (local.set $cv (call $coord_v (local.get $pos) (local.get $i2) (local.get $py)))

        (local.set $minU (call $min3 (local.get $au) (local.get $bu) (local.get $cu)))
        (local.set $maxU (call $max3 (local.get $au) (local.get $bu) (local.get $cu)))
        (local.set $minV (call $min3 (local.get $av) (local.get $bv) (local.get $cv)))
        (local.set $maxV (call $max3 (local.get $av) (local.get $bv) (local.get $cv)))

        (local.set $iu0 (call $floor (f64.div (f64.sub (local.get $minU) (local.get $uMin)) (local.get $uStep))))
        (if (i32.lt_s (local.get $iu0) (i32.const 0))
          (then (local.set $iu0 (i32.const 0))))
        (local.set $iu1 (call $ceil (f64.div (f64.sub (local.get $maxU) (local.get $uMin)) (local.get $uStep))))
        (local.set $limit (i32.sub (local.get $uBins) (i32.const 1)))
        (if (i32.gt_s (local.get $iu1) (local.get $limit))
          (then (local.set $iu1 (local.get $limit))))

        (local.set $iv0 (call $floor (f64.div (f64.sub (local.get $minV) (local.get $vMin)) (local.get $vStep))))
        (if (i32.lt_s (local.get $iv0) (i32.const 0))
          (then (local.set $iv0 (i32.const 0))))
        (local.set $iv1 (call $ceil (f64.div (f64.sub (local.get $maxV) (local.get $vMin)) (local.get $vStep))))
        (local.set $limit (i32.sub (local.get $vBins) (i32.const 1)))
        (if (i32.gt_s (local.get $iv1) (local.get $limit))
          (then (local.set $iv1 (local.get $limit))))

        ;; Same products as pointInTriUV, computed once per triangle.
        ;; w2 stays (1 - w0) - w1 so the occupancy matches JS cell for cell.
        (local.set $e0u (f64.sub (local.get $bv) (local.get $cv)))
        (local.set $e0v (f64.sub (local.get $cu) (local.get $bu)))
        (local.set $e1u (f64.sub (local.get $cv) (local.get $av)))
        (local.set $e1v (f64.sub (local.get $au) (local.get $cu)))
        (local.set $denom
          (f64.add
            (f64.mul (local.get $e0u) (local.get $e1v))
            (f64.mul (local.get $e0v) (f64.sub (local.get $av) (local.get $cv)))))
        (if (f64.lt (f64.abs (local.get $denom)) (f64.const 1e-14))
          (then
            (local.set $t (i32.add (local.get $t) (i32.const 1)))
            (br $tLoop)))

        (local.set $iv (local.get $iv0))
        (block $ivDone
          (loop $ivLoop
            (br_if $ivDone (i32.gt_s (local.get $iv) (local.get $iv1)))
            (local.set $v
              (f64.add
                (local.get $vMin)
                (f64.mul
                  (f64.add (f64.convert_i32_s (local.get $iv)) (f64.const 0.5))
                  (local.get $vStep))))
            (local.set $dv (f64.sub (local.get $v) (local.get $cv)))
            (local.set $rowB0 (f64.mul (local.get $e0v) (local.get $dv)))
            (local.set $rowB1 (f64.mul (local.get $e1v) (local.get $dv)))
            (local.set $row (i32.mul (local.get $iv) (local.get $uBins)))
            (local.set $seen (i32.const 0))
            (local.set $iu (local.get $iu0))
            (block $iuDone
              (loop $iuLoop
                (br_if $iuDone (i32.gt_s (local.get $iu) (local.get $iu1)))
                (local.set $u
                  (f64.add
                    (local.get $uMin)
                    (f64.mul
                      (f64.add (f64.convert_i32_s (local.get $iu)) (f64.const 0.5))
                      (local.get $uStep))))
                (local.set $du (f64.sub (local.get $u) (local.get $cu)))
                (local.set $w0
                  (f64.div
                    (f64.add
                      (f64.mul (local.get $e0u) (local.get $du))
                      (local.get $rowB0))
                    (local.get $denom)))
                (local.set $w1
                  (f64.div
                    (f64.add
                      (f64.mul (local.get $e1u) (local.get $du))
                      (local.get $rowB1))
                    (local.get $denom)))
                (local.set $w2 (f64.sub (f64.sub (f64.const 1) (local.get $w0)) (local.get $w1)))
                (if (i32.and
                      (i32.and
                        (f64.ge (local.get $w0) (f64.const -1e-9))
                        (f64.ge (local.get $w1) (f64.const -1e-9)))
                      (f64.ge (local.get $w2) (f64.const -1e-9)))
                  (then
                    (i32.store8
                      (i32.add (local.get $grid) (i32.add (local.get $row) (local.get $iu)))
                      (i32.const 1))
                    (local.set $seen (i32.const 1)))
                  (else
                    ;; A convex triangle crosses each row in one span.
                    (if (local.get $seen) (then (br $iuDone)))))
                (local.set $iu (i32.add (local.get $iu) (i32.const 1)))
                (br $iuLoop)))
            (local.set $iv (i32.add (local.get $iv) (i32.const 1)))
            (br $ivLoop)))

        (local.set $t (i32.add (local.get $t) (i32.const 1)))
        (br $tLoop)))
    (i32.const 1))
)
