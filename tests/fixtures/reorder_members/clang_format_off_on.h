#ifndef SampleClangFormat_H
#define SampleClangFormat_H

class SampleClangFormat {
public:
    void alpha();
    void beta();

public:
    // clang-format off
    int zebra_first;
    int apple_second;
    // clang-format on

    void gamma();
};

#endif
