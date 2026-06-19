#ifndef SampleClangFormatNested_H
#define SampleClangFormatNested_H

class SampleClangFormatNested {
public:
    void outerMethod();

public:
    // clang-format off
    //START KEVIN CAA WIZARD SECTION SampleNested PARAM DECLARATION
    int KevinFirst;
    int KevinSecond;
    //END KEVIN CAA WIZARD SECTION SampleNested PARAM DECLARATION

    //CAA2 WIZARD
    void* _WidgetA;
    void* _WidgetB;
    //END CAA2 WIZARD
    // clang-format on

    void zebra();
};

#endif
