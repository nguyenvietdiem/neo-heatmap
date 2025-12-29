$(document).ready(function () {
    $('#js-lifestyle_start').on('click', function (e) {
        e.preventDefault();
        $('#question-01').removeClass('is-hide');
        $('html, body').animate(
            {
                scrollTop: $('#question-01').offset().top,
            },
            500
        );
    });

    $('.js-question-01 > li').on('click', function (e) {
        e.preventDefault();
        $('#question-02').removeClass('is-hide');
        $('html, body').animate(
            {
                scrollTop: $('#question-02').offset().top,
            },
            500
        );
    });

    $('.js-question-02 > li').on('click', function (e) {
        e.preventDefault();
        $('#question-03').removeClass('is-hide');
        $('html, body').animate(
            {
                scrollTop: $('#question-03').offset().top,
            },
            500
        );
    });

    $('.js-question-03 > li').on('click', function (e) {
        e.preventDefault();
        $('#question-04').removeClass('is-hide');
        $('html, body').animate(
            {
                scrollTop: $('#question-04').offset().top,
            },
            500
        );
    });

    $('.js-question-04 > li').on('click', function (e) {
        e.preventDefault();
        $('#reset_btn').addClass('visible');
    });

    $('.js-again').on('click', function (e) {
        e.preventDefault();
        $('html, body').animate(
            {
                scrollTop: $('.lead-area').offset().top,
            },
            100
        );
        $('#lifestyle-diagnosis .question-sec').addClass('is-hide');
        $('.question-select-list').removeClass('pointer-events');
        $('#reset_btn').removeClass('visible');
    });
});
